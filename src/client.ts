import {
  Authorization, ActionReceipt, ActionDetail, AgentDetail, AgentVersion,
  CosignResult, EvidencePackage, ComplianceSnapshot, EscrowAccount, EscrowTransaction,
  VerifyResult, PaginatedList, AiraError,
  ComplianceReport, ComplianceReportListResponse, ComplianceReportVerification,
  ActionExplanation, ExplanationVerification,
} from "./types";
import { OfflineQueue, type QueuedRequest } from "./offline";
import { AiraSession } from "./session";

const DEFAULT_BASE_URL = "https://api.airaproof.com";
const DEFAULT_TIMEOUT = 30_000;
const MAX_DETAILS_LENGTH = 50_000;

// Binary download endpoints retry on transient 5xx (server hiccups,
// brief gateway issues). 3 attempts with exponential backoff
// (250ms -> 500ms -> 1000ms) keeps the worst case under 2s while
// absorbing the most common flakes. 4xx errors are NOT retried —
// those indicate a real problem the caller needs to see.
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_BACKOFF_BASE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a fetch with retries on transient 5xx and network errors.
 * Returns the final Response (which may itself be a 5xx after all
 * attempts are exhausted — caller decides whether to throw).
 */
async function fetchWithRetry(
  doFetch: () => Promise<Response>,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch();
      if (res.status >= 500 && attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
        await sleep(DOWNLOAD_BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
        await sleep(DOWNLOAD_BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  // Unreachable in practice — the loop either returns or throws.
  throw lastErr ?? new Error("download retry loop exited without a response");
}

function buildBody(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

function truncateDetails(text: string): string {
  return text.length > MAX_DETAILS_LENGTH ? text.slice(0, MAX_DETAILS_LENGTH) + "...[truncated]" : text;
}

export interface AiraOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  offline?: boolean;
}

export class Aira {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private queue: OfflineQueue | null;

  constructor(options: AiraOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    if (!options.apiKey.startsWith("aira_live_") && !options.apiKey.startsWith("aira_test_")) {
      console.warn("API key does not start with 'aira_live_' or 'aira_test_' — is this correct?");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "") + "/api/v1";
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.queue = options.offline ? new OfflineQueue() : null;
  }

  private async request<T = Record<string, unknown>>(
    method: string, path: string, body?: Record<string, unknown>, auth = true,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers["Authorization"] = `Bearer ${this.apiKey}`;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 204) return {} as T;

      const data = (await res.json().catch(() => ({ error: res.statusText, code: "UNKNOWN" }))) as Record<string, unknown>;

      if (!res.ok) {
        const message = (data.message as string) ?? res.statusText;
        throw new AiraError(
          res.status,
          (data.code as string) ?? "UNKNOWN",
          message,
          (data.details as Record<string, unknown>) ?? {},
        );
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T = Record<string, unknown>>(path: string, params?: Record<string, unknown>, auth = true): Promise<T> {
    if (this.queue) {
      throw new AiraError(0, "OFFLINE", "GET requests not available in offline mode");
    }
    const qs = params ? "?" + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString() : "";
    return this.request<T>("GET", path + qs, undefined, auth);
  }

  private post<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    if (this.queue) {
      const qid = this.queue.enqueue("POST", path, body);
      return Promise.resolve({ _offline: true, _queue_id: qid } as unknown as T);
    }
    return this.request<T>("POST", path, body);
  }

  private put<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    if (this.queue) {
      const qid = this.queue.enqueue("PUT", path, body);
      return Promise.resolve({ _offline: true, _queue_id: qid } as unknown as T);
    }
    return this.request<T>("PUT", path, body);
  }

  private del<T = Record<string, unknown>>(path: string): Promise<T> {
    if (this.queue) {
      const qid = this.queue.enqueue("DELETE", path, {});
      return Promise.resolve({ _offline: true, _queue_id: qid } as unknown as T);
    }
    return this.request<T>("DELETE", path);
  }

  private paginated<T = Record<string, unknown>>(data: Record<string, unknown>): PaginatedList<T> {
    const p = data.pagination as { total: number; page: number; per_page: number; has_more: boolean };
    return { data: data.data as T[], total: p.total, page: p.page, per_page: p.per_page, has_more: p.has_more };
  }

  // ==================== Actions (two-step: authorize → notarize) ====================

  /**
   * Step 1 — Authorize an action BEFORE it executes.
   *
   * Returns an `Authorization` with a status:
   *  - "authorized"       → safe to execute the action, then call `notarize()`
   *  - "pending_approval" → enqueue `action_id` and wait for human approval
   *
   * If a policy denies the action, this throws `AiraError` with code
   * `POLICY_DENIED` (HTTP 403). Duplicate idempotent requests throw
   * `DUPLICATE_REQUEST` (HTTP 409).
   */
  async authorize(params: {
    actionType: string;
    details: string;
    agentId?: string;
    agentVersion?: string;
    instructionHash?: string;
    modelId?: string;
    modelVersion?: string;
    parentActionId?: string;
    endpointUrl?: string;
    storeDetails?: boolean;
    idempotencyKey?: string;
    requireApproval?: boolean;
    approvers?: string[];
    // F10: replay context — optional reproducibility metadata.
    // Persisted on the action row, committed in the v1.3 receipt
    // payload, and surfaced via getReplayContext().
    systemPromptHash?: string;
    toolInputsHash?: string;
    modelParams?: Record<string, unknown>;
    executionEnv?: Record<string, unknown>;
  }): Promise<Authorization> {
    const body = buildBody({
      action_type: params.actionType,
      details: truncateDetails(params.details),
      agent_id: params.agentId,
      agent_version: params.agentVersion,
      instruction_hash: params.instructionHash,
      model_id: params.modelId,
      model_version: params.modelVersion,
      parent_action_id: params.parentActionId,
      endpoint_url: params.endpointUrl,
      store_details: params.storeDetails || undefined,
      idempotency_key: params.idempotencyKey,
      require_approval: params.requireApproval || undefined,
      approvers: params.approvers,
      system_prompt_hash: params.systemPromptHash,
      tool_inputs_hash: params.toolInputsHash,
      model_params: params.modelParams,
      execution_env: params.executionEnv,
    });
    return this.post<Authorization>("/actions", body);
  }

  /**
   * Step 2 — Notarize the outcome of an already-authorized action.
   *
   * Call this AFTER executing the action. Outcome is "completed" by default;
   * pass "failed" if the action ran but failed so the audit trail captures
   * the failure. The returned `ActionReceipt` carries the Ed25519 signature
   * and RFC 3161 timestamp token when the status is "notarized".
   */
  async notarize(params: {
    actionId: string;
    outcome?: "completed" | "failed";
    outcomeDetails?: string;
  }): Promise<ActionReceipt> {
    const body = buildBody({
      outcome: params.outcome ?? "completed",
      outcome_details: params.outcomeDetails,
    });
    return this.post<ActionReceipt>(`/actions/${params.actionId}/notarize`, body);
  }

  async getAction(actionId: string): Promise<ActionDetail> {
    return this.get<ActionDetail>(`/actions/${actionId}`);
  }

  async listActions(params?: { page?: number; perPage?: number; actionType?: string; agentId?: string; status?: string }): Promise<PaginatedList<ActionDetail>> {
    const data = await this.get<Record<string, unknown>>("/actions", buildBody({
      page: params?.page, per_page: params?.perPage, action_type: params?.actionType, agent_id: params?.agentId, status: params?.status,
    }));
    return this.paginated<ActionDetail>(data);
  }

  /**
   * Add a human co-signature to an action that already exists.
   *
   * This is distinct from the authorization gate (it runs against `/cosign`,
   * not `/authorize`). It records that a specific human has acknowledged or
   * signed off on an action that was already authorized and notarized.
   * Requires JWT auth (dashboard user, not an API key).
   */
  async cosign(params: { actionId: string }): Promise<CosignResult> {
    return this.post<CosignResult>(`/actions/${params.actionId}/cosign`, {});
  }

  async setLegalHold(actionId: string): Promise<Record<string, unknown>> {
    return this.post(`/actions/${actionId}/hold`, {});
  }

  async releaseLegalHold(actionId: string): Promise<Record<string, unknown>> {
    return this.del(`/actions/${actionId}/hold`);
  }

  async getActionChain(actionId: string): Promise<Record<string, unknown>[]> {
    const data = await this.get<Record<string, unknown>>(`/actions/${actionId}/chain`);
    return (data.chain as Record<string, unknown>[]) ?? [];
  }

  async verifyAction(actionId: string): Promise<VerifyResult> {
    return this.get<VerifyResult>(`/verify/action/${actionId}`, undefined, false);
  }

  // ==================== Agents ====================

  async registerAgent(params: {
    agentSlug: string;
    displayName: string;
    description?: string;
    capabilities?: string[];
    public?: boolean;
  }): Promise<AgentDetail> {
    return this.post<AgentDetail>("/agents", buildBody({
      agent_slug: params.agentSlug, display_name: params.displayName,
      description: params.description, capabilities: params.capabilities, public: params.public,
    }));
  }

  async getAgent(slug: string): Promise<AgentDetail> {
    return this.get<AgentDetail>(`/agents/${slug}`);
  }

  async listAgents(params?: { page?: number; status?: string }): Promise<PaginatedList<AgentDetail>> {
    const data = await this.get<Record<string, unknown>>("/agents", buildBody({ page: params?.page, status: params?.status }));
    return this.paginated<AgentDetail>(data);
  }

  async updateAgent(slug: string, fields: Partial<{ displayName: string; description: string; capabilities: string[]; public: boolean }>): Promise<AgentDetail> {
    return this.put<AgentDetail>(`/agents/${slug}`, buildBody({
      display_name: fields.displayName, description: fields.description,
      capabilities: fields.capabilities, public: fields.public,
    }));
  }

  async publishVersion(slug: string, params: {
    version: string; changelog?: string; modelId?: string; instructionHash?: string; configHash?: string;
  }): Promise<AgentVersion> {
    return this.post<AgentVersion>(`/agents/${slug}/versions`, buildBody({
      version: params.version, changelog: params.changelog, model_id: params.modelId,
      instruction_hash: params.instructionHash, config_hash: params.configHash,
    }));
  }

  async listVersions(slug: string): Promise<AgentVersion[]> {
    return this.get<AgentVersion[]>(`/agents/${slug}/versions`);
  }

  async decommissionAgent(slug: string): Promise<AgentDetail> {
    return this.post<AgentDetail>(`/agents/${slug}/decommission`, {});
  }

  async transferAgent(slug: string, toOrgId: string, reason?: string): Promise<Record<string, unknown>> {
    return this.post(`/agents/${slug}/transfer`, buildBody({ to_org_id: toOrgId, reason }));
  }

  async getAgentActions(slug: string, page = 1): Promise<PaginatedList> {
    const data = await this.get<Record<string, unknown>>(`/agents/${slug}/actions`, { page });
    return this.paginated(data);
  }

  // ==================== Cases ====================

  async runCase(details: string, models: string[], options?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { details, models };
    if (options) body.options = options;
    return this.post("/cases", body);
  }

  async getCase(caseId: string): Promise<Record<string, unknown>> {
    return this.get(`/cases/${caseId}`);
  }

  async listCases(page = 1): Promise<PaginatedList> {
    const data = await this.get<Record<string, unknown>>("/cases", { page });
    return this.paginated(data);
  }

  // ==================== Receipts ====================

  async getReceipt(receiptId: string): Promise<Record<string, unknown>> {
    return this.get(`/receipts/${receiptId}`);
  }

  async exportReceipt(receiptId: string, format: "json" | "pdf" = "json"): Promise<Record<string, unknown>> {
    return this.get(`/receipts/${receiptId}/export`, { format });
  }

  // ==================== Evidence ====================

  async createEvidencePackage(params: {
    title: string; actionIds: string[]; description?: string; agentSlugs?: string[];
  }): Promise<EvidencePackage> {
    return this.post<EvidencePackage>("/evidence/packages", buildBody({
      title: params.title, action_ids: params.actionIds, description: params.description, agent_slugs: params.agentSlugs,
    }));
  }

  async listEvidencePackages(page = 1): Promise<PaginatedList<EvidencePackage>> {
    const data = await this.get<Record<string, unknown>>("/evidence/packages", { page });
    return this.paginated<EvidencePackage>(data);
  }

  async getEvidencePackage(packageId: string): Promise<EvidencePackage> {
    return this.get<EvidencePackage>(`/evidence/packages/${packageId}`);
  }

  async timeTravel(params: { pointInTime: string; agentSlug?: string; actionType?: string }): Promise<Record<string, unknown>> {
    return this.post("/evidence/time-travel", buildBody({
      point_in_time: params.pointInTime, agent_slug: params.agentSlug, action_type: params.actionType,
    }));
  }

  async liabilityChain(actionId: string, maxDepth = 10): Promise<Record<string, unknown>[]> {
    const data = await this.get<Record<string, unknown>>(`/evidence/liability-chain/${actionId}`, { max_depth: maxDepth });
    return (data.chain as Record<string, unknown>[]) ?? [];
  }

  // ==================== Estate ====================

  async setAgentWill(slug: string, params: {
    successorSlug?: string; successionPolicy?: string; dataRetentionDays?: number;
    notifyEmails?: string[]; instructions?: string;
  }): Promise<Record<string, unknown>> {
    return this.put(`/estate/agents/${slug}/will`, buildBody({
      successor_slug: params.successorSlug, succession_policy: params.successionPolicy ?? "transfer_to_successor",
      data_retention_days: params.dataRetentionDays, notify_emails: params.notifyEmails, instructions: params.instructions,
    }));
  }

  async getAgentWill(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/estate/agents/${slug}/will`);
  }

  async issueDeathCertificate(slug: string, reason = "Decommissioned by organization"): Promise<Record<string, unknown>> {
    return this.post(`/estate/agents/${slug}/death-certificate`, { reason });
  }

  async getDeathCertificate(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/estate/agents/${slug}/death-certificate`);
  }

  async createComplianceSnapshot(params: {
    framework: string; agentSlug?: string; findings?: Record<string, string>;
  }): Promise<ComplianceSnapshot> {
    return this.post<ComplianceSnapshot>("/estate/compliance", buildBody({
      framework: params.framework, agent_slug: params.agentSlug, findings: params.findings,
    }));
  }

  async listComplianceSnapshots(params?: { page?: number; framework?: string }): Promise<PaginatedList<ComplianceSnapshot>> {
    const data = await this.get<Record<string, unknown>>("/estate/compliance", buildBody({
      page: params?.page, framework: params?.framework,
    }));
    return this.paginated<ComplianceSnapshot>(data);
  }

  // ==================== Escrow ====================

  async createEscrowAccount(params?: { purpose?: string; currency?: string; agentId?: string; counterpartyOrgId?: string }): Promise<EscrowAccount> {
    return this.post<EscrowAccount>("/escrow/accounts", buildBody({
      purpose: params?.purpose, currency: params?.currency ?? "EUR",
      agent_id: params?.agentId, counterparty_org_id: params?.counterpartyOrgId,
    }));
  }

  async listEscrowAccounts(page = 1): Promise<PaginatedList<EscrowAccount>> {
    const data = await this.get<Record<string, unknown>>("/escrow/accounts", { page });
    return this.paginated<EscrowAccount>(data);
  }

  async getEscrowAccount(accountId: string): Promise<EscrowAccount> {
    return this.get<EscrowAccount>(`/escrow/accounts/${accountId}`);
  }

  async escrowDeposit(accountId: string, amount: number, description?: string, referenceActionId?: string): Promise<EscrowTransaction> {
    return this.post<EscrowTransaction>(`/escrow/accounts/${accountId}/deposit`, buildBody({
      amount, description, reference_action_id: referenceActionId,
    }));
  }

  async escrowRelease(accountId: string, amount: number, description?: string, referenceActionId?: string): Promise<EscrowTransaction> {
    return this.post<EscrowTransaction>(`/escrow/accounts/${accountId}/release`, buildBody({
      amount, description, reference_action_id: referenceActionId,
    }));
  }

  async escrowDispute(accountId: string, amount: number, description: string, referenceActionId?: string): Promise<EscrowTransaction> {
    return this.post<EscrowTransaction>(`/escrow/accounts/${accountId}/dispute`, buildBody({
      amount, description, reference_action_id: referenceActionId,
    }));
  }

  // ==================== Chat ====================

  async ask(message: string, params?: { history?: Record<string, unknown>[]; model?: string }): Promise<{ content: string; tools_used: string[]; model_id?: string }> {
    return this.post("/chat", buildBody({ message, history: params?.history, model_id: params?.model }));
  }

  // ==================== DID ====================

  /** Get full DID info for an agent. */
  async getAgentDid(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/did`);
  }

  /** Rotate an agent's DID keypair. */
  async rotateAgentKeys(slug: string): Promise<Record<string, unknown>> {
    return this.post(`/agents/${slug}/did/rotate`, {});
  }

  /** Resolve any did:web DID to its DID document. */
  async resolveDid(did: string): Promise<Record<string, unknown>> {
    return this.post("/dids/resolve", { did });
  }

  // ==================== Verifiable Credentials ====================

  /** Get the current valid VC for an agent. */
  async getAgentCredential(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/credential`);
  }

  /** Get full credential history for an agent. */
  async getAgentCredentials(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/credentials`);
  }

  /** Revoke the current credential for an agent. */
  async revokeCredential(slug: string, reason = ""): Promise<Record<string, unknown>> {
    return this.post(`/agents/${slug}/credentials/revoke`, { reason });
  }

  /** Verify a Verifiable Credential — checks signature, expiry, revocation. */
  async verifyCredential(credential: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post("/credentials/verify", { credential });
  }

  // ==================== Mutual Notarization ====================

  /** Initiate a mutual signing request for an action. */
  async requestMutualSign(actionId: string, counterpartyDid: string): Promise<Record<string, unknown>> {
    return this.post(`/actions/${actionId}/mutual-sign/request`, { counterparty_did: counterpartyDid });
  }

  /** Get the action payload awaiting counterparty signature. */
  async getPendingMutualSign(actionId: string): Promise<Record<string, unknown>> {
    return this.get(`/actions/${actionId}/mutual-sign/pending`);
  }

  /** Submit counterparty signature to complete mutual signing. */
  async completeMutualSign(actionId: string, did: string, signature: string, signedPayloadHash: string): Promise<Record<string, unknown>> {
    return this.post(`/actions/${actionId}/mutual-sign/complete`, { did, signature, signed_payload_hash: signedPayloadHash });
  }

  /** Get the co-signed receipt for a mutually signed action. */
  async getMutualSignReceipt(actionId: string): Promise<Record<string, unknown>> {
    return this.get(`/actions/${actionId}/mutual-sign/receipt`);
  }

  /** Reject a mutual signing request. */
  async rejectMutualSign(actionId: string, reason = ""): Promise<Record<string, unknown>> {
    return this.post(`/actions/${actionId}/mutual-sign/reject`, { reason });
  }

  // ==================== Reputation ====================

  /** Get current reputation score for an agent. */
  async getReputation(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/reputation`);
  }

  /** Get full reputation history for an agent. */
  async getReputationHistory(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/reputation/history`);
  }

  /** Submit a signed attestation of a successful interaction. */
  async attestReputation(slug: string, counterpartyDid: string, actionId: string, attestation: string, signature: string): Promise<Record<string, unknown>> {
    return this.post(`/agents/${slug}/reputation/attest`, {
      counterparty_did: counterpartyDid, action_id: actionId, attestation, signature,
    });
  }

  /** Verify a reputation score by returning inputs and score_hash. */
  async verifyReputation(slug: string): Promise<Record<string, unknown>> {
    return this.get(`/agents/${slug}/reputation/verify`);
  }

  // ==================== Replay context (F10) ====================

  /**
   * Get all reproducibility metadata stored for an action.
   *
   * Returns the system_prompt_hash, tool_inputs_hash, model_params,
   * execution_env, and other knobs that an external replay tool
   * needs to confirm it has the same inputs as the original run.
   */
  async getReplayContext(actionId: string): Promise<Record<string, unknown>> {
    return this.get(`/actions/${actionId}/replay-context`);
  }

  // ==================== Compliance bundles ====================

  /**
   * Seal a regulator-ready evidence bundle for a date range.
   *
   * `framework` must be one of: `eu_ai_act_art12`, `iso_42001`,
   * `aiuc_1`, `soc_2_cc7`, `raw`.
   */
  async createComplianceBundle(params: {
    framework: "eu_ai_act_art12" | "iso_42001" | "aiuc_1" | "soc_2_cc7" | "raw";
    periodStart: string;
    periodEnd: string;
    title?: string;
    agentFilter?: string[];
    /**
     * Client-supplied key (unique per org) — retrying with the same key
     * returns the original bundle and does NOT charge a second operation.
     * Use this if your job runner may replay the call on network flakes.
     */
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>> {
    const body = buildBody({
      framework: params.framework,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      title: params.title,
      agent_filter: params.agentFilter,
      idempotency_key: params.idempotencyKey,
    });
    return this.post("/compliance/bundles", body);
  }

  async listComplianceBundles(page = 1, perPage = 20): Promise<PaginatedList<Record<string, unknown>>> {
    const data = await this.get<Record<string, unknown>>(
      `/compliance/bundles?page=${page}&per_page=${perPage}`,
    );
    return this.paginated<Record<string, unknown>>(data);
  }

  async getComplianceBundle(bundleId: string): Promise<Record<string, unknown>> {
    return this.get(`/compliance/bundles/${bundleId}`);
  }

  /**
   * Download the self-contained JSON document for the bundle. The
   * exported document inlines every receipt's signed payload + signature
   * and the JWKS URL so an auditor can re-verify offline.
   */
  async exportComplianceBundle(bundleId: string): Promise<Record<string, unknown>> {
    return this.get(`/compliance/bundles/${bundleId}/export`);
  }

  async getBundleInclusionProof(bundleId: string, receiptId: string): Promise<Record<string, unknown>> {
    return this.get(`/compliance/bundles/${bundleId}/inclusion-proof/${receiptId}`);
  }

  // ==================== Drift detection ====================

  /**
   * Score the agent's recent behavior against its active baseline.
   * Read-only — does NOT persist an alert. Use this for dashboards.
   */
  async getDriftStatus(agentId: string, lookbackHours = 24): Promise<Record<string, unknown>> {
    return this.get(`/agents/${agentId}/drift?lookback_hours=${lookbackHours}`);
  }

  /** Compute a behavioral baseline from production action history. */
  async computeDriftBaseline(params: {
    agentId: string;
    windowStart: string;
    windowEnd: string;
    activate?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.post(
      `/agents/${params.agentId}/drift/baseline`,
      buildBody({
        window_start: params.windowStart,
        window_end: params.windowEnd,
        activate: params.activate ?? true,
      }),
    );
  }

  /** Seed a baseline from a config dict (for cold-start agents). */
  async seedSyntheticBaseline(params: {
    agentId: string;
    expectedDistribution: Record<string, number>;
    expectedActionsPerDay: number;
    activate?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.post(
      `/agents/${params.agentId}/drift/baseline/synthetic`,
      buildBody({
        expected_distribution: params.expectedDistribution,
        expected_actions_per_day: params.expectedActionsPerDay,
        activate: params.activate ?? true,
      }),
    );
  }

  /** Score the current window and persist an alert if it exceeds the threshold. */
  async runDriftCheck(agentId: string, lookbackHours = 24): Promise<Record<string, unknown> | null> {
    return this.post(
      `/agents/${agentId}/drift/check?lookback_hours=${lookbackHours}`,
      {},
    );
  }

  async listDriftAlerts(
    agentId: string,
    page = 1,
    acknowledged?: boolean,
  ): Promise<PaginatedList<Record<string, unknown>>> {
    let params = `page=${page}&per_page=50`;
    if (acknowledged !== undefined) {
      params += `&acknowledged=${acknowledged}`;
    }
    const data = await this.get<Record<string, unknown>>(
      `/agents/${agentId}/drift/alerts?${params}`,
    );
    return this.paginated<Record<string, unknown>>(data);
  }

  async acknowledgeDriftAlert(agentId: string, alertId: string): Promise<Record<string, unknown>> {
    return this.post(`/agents/${agentId}/drift/alerts/${alertId}/acknowledge`, {});
  }

  // ==================== Merkle settlement (F8) ====================

  /**
   * Seal every unsettled receipt for the org into a new settlement.
   * Admin-only. Returns the new settlement, or null if there were no
   * unsettled receipts (no-op).
   */
  async createSettlement(): Promise<Record<string, unknown> | null> {
    return this.post("/settlements", {});
  }

  async listSettlements(page = 1, perPage = 20): Promise<PaginatedList<Record<string, unknown>>> {
    const data = await this.get<Record<string, unknown>>(
      `/settlements?page=${page}&per_page=${perPage}`,
    );
    return this.paginated<Record<string, unknown>>(data);
  }

  async getSettlement(settlementId: string): Promise<Record<string, unknown>> {
    return this.get(`/settlements/${settlementId}`);
  }

  /** Get the Merkle inclusion proof for one receipt in its settlement. */
  async getSettlementInclusionProof(receiptId: string): Promise<Record<string, unknown>> {
    return this.get(`/settlements/inclusion-proof/${receiptId}`);
  }

  // ==================== Compliance reports (Phase 1) ====================

  /**
   * Generate a regulatory PDF report.
   *
   * Frameworks:
   * - `eu_ai_act_art12` — Annex VII technical file. Requires period.
   * - `eu_ai_act_art9` — risk management register. Requires period.
   * - `eu_ai_act_art6` — single-action explanation. Requires actionId.
   * - `eu_ai_act_annex_iv` — full Annex IV technical documentation
   *   (§§1..9). Requires period. Typical use: annual file for the
   *   high-risk AI system provider obligations in Article 11.
   */
  async createComplianceReport(params: {
    framework: string;
    periodStart?: string;
    periodEnd?: string;
    actionId?: string;
    agentFilter?: string[];
  }): Promise<ComplianceReport> {
    const body = buildBody({
      framework: params.framework,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      action_id: params.actionId,
      agent_filter: params.agentFilter,
    });
    return this.post<ComplianceReport>("/compliance/reports", body);
  }

  /** Get the metadata for a compliance report (no PDF bytes). */
  async getComplianceReport(reportId: string): Promise<ComplianceReport> {
    return this.get<ComplianceReport>(`/compliance/reports/${reportId}`);
  }

  /** List compliance reports with optional filters. */
  async listComplianceReports(params?: {
    framework?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<ComplianceReportListResponse> {
    return this.get<ComplianceReportListResponse>(
      "/compliance/reports",
      buildBody({ ...params }),
    );
  }

  /**
   * Download the generated PDF as raw bytes (Uint8Array).
   *
   * Retries on transient 5xx and network errors (3 attempts,
   * exponential backoff). 4xx responses surface immediately.
   */
  async downloadComplianceReport(reportId: string): Promise<Uint8Array> {
    if (this.queue) {
      throw new AiraError(
        0,
        "OFFLINE",
        "Downloads are not available in offline mode",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetchWithRetry(() =>
        fetch(`${this.baseUrl}/compliance/reports/${reportId}/download`, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        }),
      );
      if (!res.ok) {
        throw new AiraError(res.status, "DOWNLOAD_FAILED", res.statusText);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Verify a compliance report's signature and content hash. */
  async verifyComplianceReport(
    reportId: string,
  ): Promise<ComplianceReportVerification> {
    return this.get<ComplianceReportVerification>(
      `/compliance/reports/${reportId}/verify`,
    );
  }

  /**
   * Article 6 right-to-explanation for a single action.
   *
   * The response includes a cryptographic ``_envelope`` — verify it
   * later with {@link verifyActionExplanation} (the verify endpoint
   * is public, so anyone holding the JSON can re-check it).
   */
  async getActionExplanation(actionId: string): Promise<ActionExplanation> {
    return this.get<ActionExplanation>(
      `/actions/${actionId}/explanation`,
    );
  }

  /**
   * Public verify — recompute an explanation envelope's signature.
   *
   * POSTs the full explanation JSON to the unauthenticated
   * ``/verify/explanation`` endpoint. The server looks up the public
   * key by ``_envelope.signing_key_id`` and re-derives the canonical
   * content hash + Ed25519 signature.
   *
   * ``request_id`` is stripped before sending, so a saved JSON
   * explanation verifies the same way regardless of whether the
   * caller round-tripped it through their own logs.
   */
  async verifyActionExplanation(
    explanation: ActionExplanation | Record<string, unknown>,
  ): Promise<ExplanationVerification> {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(explanation)) {
      if (k === "request_id") continue;
      payload[k] = v;
    }
    return this.request<ExplanationVerification>(
      "POST",
      "/verify/explanation",
      { explanation: payload },
      false, // public endpoint — no Authorization header
    );
  }

  /**
   * Download the Article 6 explanation as a PDF.
   *
   * Retries on transient 5xx and network errors (3 attempts,
   * exponential backoff). 4xx responses surface immediately.
   */
  async downloadActionExplanationPdf(actionId: string): Promise<Uint8Array> {
    if (this.queue) {
      throw new AiraError(
        0,
        "OFFLINE",
        "Downloads are not available in offline mode",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetchWithRetry(() =>
        fetch(`${this.baseUrl}/actions/${actionId}/explanation/pdf`, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        }),
      );
      if (!res.ok) {
        throw new AiraError(res.status, "DOWNLOAD_FAILED", res.statusText);
      }
      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  // ==================== Session ====================

  /** Create a scoped session with pre-filled defaults. */
  session(agentId: string, defaults?: Record<string, unknown>): AiraSession {
    return new AiraSession(this, agentId, defaults);
  }

  // ==================== Offline sync ====================

  /** Number of queued offline requests. */
  get pendingCount(): number {
    return this.queue?.pendingCount ?? 0;
  }

  /** Flush offline queue to API. Returns list of API responses. */
  async sync(): Promise<Record<string, unknown>[]> {
    if (!this.queue) throw new Error("sync() is only available in offline mode");
    const items = this.queue.drain();
    const results: Record<string, unknown>[] = [];
    for (const item of items) {
      const res = await this.request<Record<string, unknown>>(item.method, item.path, item.body);
      results.push(res);
    }
    return results;
  }
}
