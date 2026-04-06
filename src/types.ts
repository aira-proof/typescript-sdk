/** Cryptographic receipt from notarizing an action. */
export interface ActionReceipt {
  action_id: string;
  receipt_id: string;
  payload_hash: string;
  signature: string;
  timestamp_token: string | null;
  created_at: string;
  request_id: string;
  status?: string;
  action_type?: string;
  agent_id?: string | null;
  warnings?: string[] | null;
  policy_evaluation?: {
    policy_id: string;
    policy_name: string;
    decision: string;
    reasoning: string | null;
    confidence: number | null;
  } | null;
}

/** Full action details including receipt and authorizations. */
export interface ActionDetail {
  action_id: string;
  action_type: string;
  action_details_hash: string;
  agent_id: string | null;
  model_id: string | null;
  instruction_hash: string | null;
  parent_action_id: string | null;
  status: string;
  legal_hold: boolean;
  created_at: string;
  receipt: {
    receipt_id: string;
    payload_hash: string;
    signature: string;
    public_key_id: string;
    timestamp_token: string | null;
    receipt_version: string;
    verify_url: string;
  } | null;
  authorizations: { id: string; authorizer_email: string; authorized_at: string | null }[];
  request_id: string;
}

/** Registered agent identity. */
export interface AgentDetail {
  id: string;
  agent_slug: string;
  display_name: string;
  description: string | null;
  capabilities: string[] | null;
  status: string;
  public: boolean;
  registered_at: string;
  metadata: Record<string, unknown> | null;
  versions: AgentVersion[];
  request_id: string;
}

/** Agent version info. */
export interface AgentVersion {
  id: string;
  version: string;
  model_id: string | null;
  instruction_hash: string | null;
  config_hash: string | null;
  changelog: string | null;
  status: string;
  published_at: string | null;
}

/** Sealed evidence package. */
export interface EvidencePackage {
  id: string;
  title: string;
  description: string | null;
  action_ids: string[];
  package_hash: string;
  signature: string;
  status: string;
  created_at: string;
  request_id: string;
  agent_slugs?: string[] | null;
}

/** Compliance snapshot. */
export interface ComplianceSnapshot {
  id: string;
  framework: string;
  status: string;
  findings: Record<string, string>;
  snapshot_hash: string;
  signature: string;
  snapshot_at: string;
  created_at: string;
  request_id: string;
  agent_id?: string | null;
}

/** Escrow account. */
export interface EscrowAccount {
  id: string;
  currency: string;
  balance: string;
  status: string;
  created_at: string;
  request_id: string;
  agent_id?: string | null;
  counterparty_org_id?: string | null;
  purpose?: string | null;
  transactions?: EscrowTransaction[];
}

/** Escrow transaction (deposit, release, dispute). */
export interface EscrowTransaction {
  id: string;
  transaction_type: string;
  amount: string;
  currency: string;
  transaction_hash: string;
  signature: string;
  status: string;
  created_at: string;
  description?: string | null;
  reference_action_id?: string | null;
}

/** Public verification result. */
export interface VerifyResult {
  valid: boolean;
  public_key_id: string;
  message: string;
  verified_at: string;
  request_id: string;
  receipt_id?: string | null;
  action_id?: string | null;
}

/** Paginated list response. */
export interface PaginatedList<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

/** Aira API error. */
export class AiraError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "AiraError";
    this.status = status;
    this.code = code;
  }
}
