import {
  ActionReceipt, ActionDetail, AgentDetail, AgentVersion,
  EvidencePackage, ComplianceSnapshot, EscrowAccount, EscrowTransaction,
  VerifyResult, PaginatedList, AiraError,
} from "./types";

const DEFAULT_BASE_URL = "https://api.airaproof.com";
const DEFAULT_TIMEOUT = 30_000;
const MAX_DETAILS_LENGTH = 50_000;

function buildBody(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

function sanitizeDetails(text: string): string {
  return text.length > MAX_DETAILS_LENGTH ? text.slice(0, MAX_DETAILS_LENGTH) + "...[truncated]" : text;
}

export interface AiraOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class Aira {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(options: AiraOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    if (!options.apiKey.startsWith("aira_live_") && !options.apiKey.startsWith("aira_test_")) {
      console.warn("API key does not start with 'aira_live_' or 'aira_test_' — is this correct?");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "") + "/api/v1";
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
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
        throw new AiraError(res.status, (data.code as string) ?? "UNKNOWN", (data.error as string) ?? res.statusText);
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T = Record<string, unknown>>(path: string, params?: Record<string, unknown>, auth = true): Promise<T> {
    const qs = params ? "?" + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString() : "";
    return this.request<T>("GET", path + qs, undefined, auth);
  }

  private post<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private put<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private del<T = Record<string, unknown>>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private paginated<T = Record<string, unknown>>(data: Record<string, unknown>): PaginatedList<T> {
    const p = data.pagination as { total: number; page: number; per_page: number; has_more: boolean };
    return { data: data.data as T[], total: p.total, page: p.page, per_page: p.per_page, has_more: p.has_more };
  }

  // ==================== Actions ====================

  async notarize(params: {
    actionType: string;
    details: string;
    agentId?: string;
    agentVersion?: string;
    modelId?: string;
    modelVersion?: string;
    instructionHash?: string;
    parentActionId?: string;
    storeDetails?: boolean;
    idempotencyKey?: string;
  }): Promise<ActionReceipt> {
    const body = buildBody({
      action_type: params.actionType,
      details: sanitizeDetails(params.details),
      agent_id: params.agentId,
      agent_version: params.agentVersion,
      model_id: params.modelId,
      model_version: params.modelVersion,
      instruction_hash: params.instructionHash,
      parent_action_id: params.parentActionId,
      store_details: params.storeDetails || undefined,
      idempotency_key: params.idempotencyKey,
    });
    return this.post<ActionReceipt>("/actions", body);
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

  async authorizeAction(actionId: string): Promise<Record<string, unknown>> {
    return this.post(`/actions/${actionId}/authorize`, {});
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
    return this.post("/chat", buildBody({ message, history: params?.history, model: params?.model }));
  }
}
