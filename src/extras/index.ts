/**
 * Aira SDK extras — framework integrations.
 *
 * Each integration is in its own file to avoid importing unnecessary
 * dependencies. Import directly from the subpath:
 *
 *   import { AiraCallbackHandler } from "aira-sdk/extras/langchain";
 *   import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
 *   import { AiraGuardrail } from "aira-sdk/extras/openai-agents";
 *   import { createServer } from "aira-sdk/extras/mcp";
 *   import { verifySignature, parseEvent } from "aira-sdk/extras/webhooks";
 *
 * Every integration is honestly labeled as one of three kinds:
 *
 *   "gate"    — intercepts before execution and can deny. authorize()
 *               runs first; if the policy engine denies, the wrapped
 *               call never runs.
 *   "audit"   — runs after execution because the host framework does not
 *               expose a pre-execution hook that can abort. Aira still
 *               records a signed receipt; it just cannot prevent the
 *               action.
 *   "adapter" — exposes Aira's own API as a tool the host framework can
 *               call. Neither a gate nor an audit hook over other tools.
 *
 * The INTEGRATIONS registry below is the single source of truth — the
 * README integration matrix is generated from it so the docs cannot
 * drift from the code.
 */

export { AiraCallbackHandler } from "./langchain";
export { AiraVercelMiddleware } from "./vercel-ai";
export { AiraGuardrail } from "./openai-agents";
export { createServer, getTools, handleToolCall } from "./mcp";
export type { MCPTool, MCPTextContent } from "./mcp";
export { verifySignature, parseEvent, WebhookEventType } from "./webhooks";
export type { WebhookEvent, WebhookEventTypeName } from "./webhooks";
export { checkTrust } from "./trust";
export type { TrustPolicy, TrustContext } from "./trust";

export type IntegrationKind = "gate" | "audit" | "adapter";

export interface IntegrationSpec {
  /** Human display name. */
  name: string;
  /** SDK subpath: aira-sdk/extras/{module}. */
  module: string;
  /** Primary exported symbol. */
  symbol: string;
  /** Honest classification. */
  kind: IntegrationKind;
  /**
   * True if Aira can intercept and deny BEFORE the underlying call runs.
   * Must be true for kind=="gate" and false otherwise.
   */
  preExecutionGate: boolean;
  /** What the integration wraps. */
  surface: string;
  /** Why this is gate / audit / adapter — surface in docs and tests. */
  notes: string;
}

/**
 * The single source of truth for the integration matrix. Tests pin this
 * registry; the README is generated from it. To add a new integration:
 *
 *   1. Implement the file under src/extras/
 *   2. Add an IntegrationSpec entry here
 *   3. Run `npm test` — failing tests will tell you what to update
 */
export const INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    name: "LangChain.js",
    module: "langchain",
    symbol: "AiraCallbackHandler",
    kind: "gate",
    preExecutionGate: true,
    surface: "Tools (gate). Chains and LLM completions are audit-only.",
    notes:
      "handleToolStart calls authorize() and throws on POLICY_DENIED so the " +
      "tool never runs. Chain/LLM hooks are post-hoc because LangChain has " +
      "no pre-execution chain hook that can abort.",
  },
  {
    name: "Vercel AI SDK",
    module: "vercel-ai",
    symbol: "AiraVercelMiddleware",
    kind: "gate",
    preExecutionGate: true,
    surface: "Tools via wrapTool() (gate). onFinish helpers are audit-only.",
    notes:
      "wrapTool() wraps a tool's execute function so authorize() runs " +
      "before the tool body. onStepFinish / onFinish callbacks fire after " +
      "execution and are explicitly labeled audit-only — Vercel AI has no " +
      "pre-step hook.",
  },
  {
    name: "OpenAI Agents",
    module: "openai-agents",
    symbol: "AiraGuardrail",
    kind: "gate",
    preExecutionGate: true,
    surface: "Tools via wrapTool()",
    notes:
      "Wraps each tool function: authorize() runs before the tool body. " +
      "Denied calls throw; failed calls notarize with outcome=failed.",
  },
  {
    name: "MCP",
    module: "mcp",
    symbol: "createServer",
    kind: "adapter",
    preExecutionGate: false,
    surface: "Server adapter (exposes Aira as MCP tools)",
    notes:
      "MCP is bidirectional: the agent CHOOSES to call authorize_action / " +
      "notarize_action. This is not a wrapper over other MCP tools — it is " +
      "a protocol adapter that lets MCP-aware agents reach Aira.",
  },
  {
    name: "Webhooks",
    module: "webhooks",
    symbol: "verifySignature",
    kind: "adapter",
    preExecutionGate: false,
    surface: "HMAC-SHA256 webhook signature verifier",
    notes:
      "Standalone HMAC verification helper. Not an agent integration.",
  },
];

/** Render INTEGRATIONS as a Markdown table for the README. */
export function integrationMatrixMarkdown(): string {
  const header =
    "| Integration | Type | Pre-execution gate? | Surface | Notes |\n" +
    "|---|---|---|---|---|";
  const rows = INTEGRATIONS.map(
    (i) =>
      `| **${i.name}** | ${i.kind} | ${i.preExecutionGate ? "Yes" : "No"} | ${i.surface} | ${i.notes} |`,
  );
  return [header, ...rows].join("\n");
}
