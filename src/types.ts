/**
 * Authorization result from `authorize()` — Step 1 of the two-step flow.
 *
 * Status tells you what to do next:
 *  - "authorized"       → execute the action, then call `notarize()`
 *  - "pending_approval" → enqueue the action_id and wait for human approval
 *
 * POLICY_DENIED is raised as an `AiraError` — not returned as a status.
 */
export interface Authorization {
  action_id: string;
  status: "authorized" | "pending_approval";
  created_at: string;
  request_id: string;
  warnings: string[] | null;
}

/**
 * Cryptographic receipt from notarizing an action — Step 2 of the two-step flow.
 *
 * Only populated when `status === "notarized"`. For "failed" outcomes,
 * the receipt fields stay null — only the audit trail is recorded.
 */
export interface ActionReceipt {
  action_id: string;
  status: "notarized" | "failed";
  created_at: string;
  request_id: string;
  receipt_id: string | null;
  payload_hash: string | null;
  signature: string | null;
  timestamp_token: string | null;
  warnings: string[] | null;
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
    created_at: string | null;
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
  created_at: string;
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

/**
 * Result of a public action receipt verification.
 *
 * The endpoint actually recomputes the SHA-256 hash and verifies the
 * Ed25519 signature against the published public key — `valid` is the
 * result of that real cryptographic check, not just an existence check.
 *
 * On a successful (or tamper-detected) verification the result includes
 * the full evidence — `signature`, `public_key`, `signed_payload`,
 * `timestamp_token` — so an external auditor can re-run the same check
 * with OpenSSL or any Ed25519 library without trusting Aira's verdict.
 */
export interface VerifyResult {
  valid: boolean;
  public_key_id: string;
  message: string;
  verified_at: string;
  request_id: string;
  receipt_id?: string | null;
  action_id?: string | null;
  payload_hash?: string | null;
  signature?: string | null;
  public_key?: string | null;
  algorithm?: string | null;
  timestamp_token?: string | null;
  signed_payload?: Record<string, unknown> | null;
}

/** Paginated list response. */
export interface PaginatedList<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

/**
 * Human co-signature on an action.
 *
 * Returned by `Aira.cosign()`. Records that a specific human has
 * acknowledged or signed off on an action that was already authorized
 * (and optionally already notarized).
 */
export interface CosignResult {
  cosignature_id: string;
  action_id: string;
  cosigner_email: string;
  cosigned_at: string;
  request_id: string;
}

/**
 * Aira API error.
 *
 * There is a single error type — catch `AiraError` and branch on
 * `e.code` (`"POLICY_DENIED"`, `"INVALID_STATE"`, `"NOT_FOUND"`, ...).
 * There are no subclasses per error code.
 */
export class AiraError extends Error {
  /** HTTP status code from the backend response. */
  statusCode: number;
  /** Error code string (e.g. "POLICY_DENIED", "INVALID_STATE"). */
  code: string;
  /** Optional backend-supplied context (policy_id, action_id, etc.). */
  details: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`[${code}] ${message}`);
    this.name = "AiraError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
