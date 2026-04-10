import {
  Authorization, ActionReceipt, ActionDetail, AgentDetail, AgentVersion,
  CosignResult, EvidencePackage, ComplianceSnapshot, EscrowAccount, EscrowTransaction,
  VerifyResult, PaginatedList, AiraError,
} from "./types";
import { OfflineQueue, type QueuedRequest } from "./offline";
import { AiraSession } from "./session";

const DEFAULT_BASE_URL = "https://api.airaproof.com";
const DEFAULT_TIMEOUT = 30_000;
const MAX_DETAILS_LENGTH = 50_000;

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
