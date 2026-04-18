/**
 * Compliance framework identifiers — string values accepted by
 * `Aira.createComplianceReport()` and returned on `ComplianceReport.framework`.
 * Import these constants rather than hard-coding the wire strings so
 * callers stay in lockstep with the backend if a name ever changes.
 */
export const FRAMEWORK_ART12 = "eu_ai_act_art12" as const;
export const FRAMEWORK_ART9 = "eu_ai_act_art9" as const;
export const FRAMEWORK_ART6 = "eu_ai_act_art6" as const;
export const FRAMEWORK_ANNEX_IV = "eu_ai_act_annex_iv" as const;

/**
 * Authorization result from `authorize()` — Step 1 of the two-step flow.
 *
 * Status tells you what to do next:
 *  - "authorized"       → execute the action, then call `notarize()`
 *  - "pending_approval" → enqueue the action_uuid and wait for human approval
 *
 * POLICY_DENIED is raised as an `AiraError` — not returned as a status.
 */
export interface Authorization {
  action_uuid: string;
  status: "authorized" | "pending_approval";
  created_at: string;
  request_id: string;
  warnings: string[] | null;
}

/**
 * Cryptographic receipt from notarizing an action — Step 2 of the two-step flow.
 *
 * Status values:
 *  - "notarized"       — action completed successfully, receipt minted
 *  - "failed"          — action failed, Ed25519 receipt still minted for audit
 *  - "denied"          — policy denied the action, Ed25519 receipt minted for the denial
 *  - "denied_by_human" — human reviewer denied the action, Ed25519 receipt minted
 *
 * Every action state produces an Ed25519 receipt — the audit trail has zero gaps.
 */
export interface ActionReceipt {
  action_uuid: string;
  status: "notarized" | "failed" | "denied" | "denied_by_human";
  created_at: string;
  request_id: string;
  receipt_uuid: string | null;
  payload_hash: string | null;
  signature: string | null;
  timestamp_token: string | null;
  /**
   * Output content-scan result attached at notarize time when the
   * org has an output policy enabled. ``null`` when output filtering
   * is off (global flag or per-org).
   */
  output_scan_flags?: OutputScanFlags | null;
  warnings: string[] | null;
}

export interface OutputScanHit {
  name: string;
  library: string;
  severity: "info" | "warning" | "critical";
  description: string;
  matches: number;
  /** Always `"[REDACTED]"` — the matched fragment never travels. */
  sample: string;
}

export interface OutputScanFlags {
  scanned_at: string;
  libraries: string[];
  mode: "flag" | "deny" | "redact";
  decision: "allow" | "require_approval" | "deny";
  worst_severity: "info" | "warning" | "critical" | null;
  hits: OutputScanHit[];
}

export interface OutputPolicy {
  enabled: boolean;
  mode: "flag" | "deny" | "redact";
  libraries: string[];
  deny_severity_threshold: "info" | "warning" | "critical";
  redact_severity_threshold: "info" | "warning" | "critical";
  request_id: string;
}

export interface DoraIncident {
  uuid: string;
  title: string;
  status: "detected" | "classified" | "resolved" | "reported";
  severity: "critical" | "high" | "medium" | "low" | null;
  category: string | null;
  is_major: boolean;
  detected_at: string;
  classified_at: string | null;
  resolved_at: string | null;
  reported_at: string | null;
  clients_affected_count: number;
  has_report: boolean;
  created_at: string;
  org_uuid?: string | null;
  description?: string | null;
  affected_services?: string[] | null;
  geographic_scope?: string[] | null;
  root_cause_summary?: string | null;
  root_cause_classification?: string | null;
  third_party_uuid?: string | null;
  resolution_summary?: string | null;
  lessons_learned?: string | null;
  related_action_uuids?: string[] | null;
  report_content_hash?: string | null;
  report_signature?: string | null;
  report_signing_key_id?: string | null;
  report_signed_at?: string | null;
  report_pdf_size_bytes?: number | null;
  request_id?: string;
}

export interface IctThirdParty {
  uuid: string;
  org_uuid: string;
  vendor_name: string;
  service_description: string;
  service_type: string;
  criticality: "critical" | "non_critical" | "supporting";
  contract_start_date: string | null;
  contract_end_date: string | null;
  exit_strategy_summary: string | null;
  subcontractors: string[] | null;
  data_categories: string[] | null;
  jurisdiction: string | null;
  is_active: boolean;
  created_at: string;
  request_id?: string;
}

export interface DoraTest {
  uuid: string;
  test_type: string;
  title: string;
  conducted_at: string;
  conducted_by: string;
  status: "passed" | "failed" | "partial";
}

export interface OutputPolicyUpdate {
  enabled?: boolean;
  mode?: "flag" | "deny" | "redact";
  libraries?: string[];
  deny_severity_threshold?: "info" | "warning" | "critical";
  redact_severity_threshold?: "info" | "warning" | "critical";
}

/** Full action details including receipt and authorizations. */
export interface ActionDetail {
  action_uuid: string;
  org_uuid: string;
  action_type: string;
  action_details_hash: string;
  agent_id: string | null;
  model_id: string | null;
  instruction_hash: string | null;
  parent_action_uuid: string | null;
  status: string;
  legal_hold: boolean;
  created_at: string;
  receipt: {
    receipt_uuid: string;
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
  system_prompt_hash?: string | null;
  tool_inputs_hash?: string | null;
  model_params?: Record<string, unknown> | null;
  execution_env?: Record<string, unknown> | null;
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
  action_uuids: string[];
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
  counterparty_org_uuid?: string | null;
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
  reference_action_uuid?: string | null;
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
  receipt_uuid?: string | null;
  action_uuid?: string | null;
  payload_hash?: string | null;
  signature?: string | null;
  public_key?: string | null;
  algorithm?: string | null;
  timestamp_token?: string | null;
  signed_payload?: Record<string, unknown> | null;
  policy_evaluator_attestation?: { evaluator_key_id: string; signature: string; payload_hash: string } | null;
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
  cosignature_uuid: string;
  action_uuid: string;
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
  /** Optional backend-supplied context (policy_uuid, action_uuid, receipt_uuid, etc.).
   *  For POLICY_DENIED errors, `receipt_uuid` is the Ed25519 receipt minted for the denial. */
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


// ─── Compliance reports (Phase 1) ──────────────────────────────────

export interface ComplianceReport {
  id: string;
  framework: string;
  status: "pending" | "generating" | "ready" | "failed";
  created_at: string;
  request_id?: string;
  org_uuid?: string;
  period_start?: string | null;
  period_end?: string | null;
  action_uuid?: string | null;
  agent_filter?: string[] | null;
  receipt_count?: number | null;
  pdf_size_bytes?: number | null;
  content_hash?: string | null;
  signature?: string | null;
  signing_key_id?: string | null;
  timestamp_token?: string | null;
  timestamp_token_present?: boolean;
  report_metadata?: Record<string, unknown> | null;
  error_message?: string | null;
  generated_at?: string | null;
}

export interface ComplianceReportListResponse {
  items: ComplianceReport[];
  total: number;
  limit: number;
  offset: number;
  request_id: string;
}

export interface ComplianceReportVerification {
  report_uuid: string;
  valid: boolean;
  checks: Record<string, unknown>;
  descriptor?: Record<string, unknown> | null;
  request_id: string;
}

export interface ExplanationEnvelope {
  alg: string;
  signing_key_id: string;
  content_hash: string;
  signature: string;
  generated_at: string;
}

export interface ActionExplanation {
  action: Record<string, unknown>;
  policy_chain: Array<Record<string, unknown>>;
  approval_chain: Array<Record<string, unknown>>;
  receipt?: Record<string, unknown> | null;
  regulation: Record<string, unknown>;
  /**
   * Ed25519 signature over the canonical JSON of every field above
   * (except ``_envelope`` itself and ``request_id``). The on-wire key
   * is ``_envelope`` — the SDK exposes it under the same name so a
   * saved ``JSON.stringify(explanation)`` round-trips through
   * :meth:`Aira.verifyActionExplanation` untouched.
   */
  _envelope?: ExplanationEnvelope;
  request_id: string;
}

export interface ExplanationVerification {
  valid: boolean;
  checks: Record<string, unknown>;
  signing_key_id?: string | null;
  request_id: string;
}
