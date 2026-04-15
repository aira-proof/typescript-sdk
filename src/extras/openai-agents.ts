/**
 * OpenAI Agents SDK integration — pre-execution gate via tool wrapping.
 *
 * Requires: @openai/agents (peer dependency)
 *
 * ---------------------------------------------------------------------------
 * LIFECYCLE & DESIGN NOTES
 * ---------------------------------------------------------------------------
 *
 * The OpenAI Agents SDK supports guardrails that run BEFORE the model produces
 * output (`inputGuardrails`) and BEFORE a tool executes (via wrapping the
 * tool's `execute` / function). Either path can throw to abort the run, so
 * both qualify as a REAL authorization gate.
 *
 * `AiraGuardrail.wrapTool()` is the cleanest integration: it calls
 * `aira.authorize()` before the tool runs. If the backend responds with:
 *
 *   - "authorized"         → the tool runs; `aira.notarize()` is called
 *                            with outcome="completed" (or "failed" on throw).
 *   - "pending_approval"   → we throw. The agent never sees the tool result;
 *                            it handles the error like any other tool failure.
 *   - AiraError POLICY_DENIED → rethrown. Tool is blocked entirely.
 *
 * Behavior on authorize network/5xx errors is controlled by `strict`:
 *   - strict=false (default) → fail open with a warning. Tool runs, no receipt.
 *   - strict=true            → fail closed. Tool throws.
 */

import type { Aira } from "../client";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export interface AiraGuardrailOptions {
  modelId?: string;
  trustPolicy?: TrustPolicy;
  /** Fail closed if authorize() fails (network, 5xx). Default: false. */
  strict?: boolean;
}

export class AiraGuardrail {
  private client: Aira;
  private agentId: string;
  private modelId?: string;
  private trustPolicy?: TrustPolicy;
  private strict: boolean;

  constructor(
    client: Aira,
    agentId: string,
    options?: AiraGuardrailOptions,
  ) {
    this.client = client;
    this.agentId = agentId;
    this.modelId = options?.modelId;
    this.trustPolicy = options?.trustPolicy;
    this.strict = options?.strict ?? false;
  }

  /**
   * Check trust for a counterparty agent before interacting.
   * Advisory by default — only blocks on revoked VC or unregistered agent if configured.
   */
  async checkTrust(counterpartyId: string): Promise<TrustContext> {
    if (!this.trustPolicy) {
      return { counterpartyId, blocked: false, recommendation: "No trust policy configured" };
    }
    return checkTrust(this.client, this.trustPolicy, counterpartyId);
  }

  /**
   * REAL GATE: call `authorize()` for a tool invocation.
   *
   * Returns the action_uuid on success, throws on POLICY_DENIED or
   * pending_approval. Arg keys are logged (not values) to avoid leaking
   * sensitive user input into audit trails.
   */
  async authorizeToolCall(toolName: string, args?: Record<string, unknown>): Promise<string | null> {
    const argKeys = Object.keys(args ?? {});
    try {
      const auth = await this.client.authorize({
        actionType: "tool_call",
        details: `Tool '${toolName}' called. Arg keys: [${argKeys.join(", ")}]`.slice(0, MAX_DETAILS),
        agentId: this.agentId,
        modelId: this.modelId,
      });
      if (auth.status === "pending_approval") {
        const err = new Error(
          `Aira: tool '${toolName}' is pending human approval (action_uuid=${auth.action_uuid}). Tool execution blocked.`,
        );
        (err as Error & { code?: string }).code = "PENDING_APPROVAL";
        throw err;
      }
      return auth.action_uuid;
    } catch (e) {
      const err = e as Error & { code?: string };
      // Always propagate authorization-layer rejections.
      if (err.code === "POLICY_DENIED" || err.code === "PENDING_APPROVAL") throw e;
      if (this.strict) throw e;
      console.warn("Aira authorize failed (fail-open):", err);
      return null;
    }
  }

  /** Notarize the outcome of a previously authorized tool call. */
  async notarizeToolResult(
    actionId: string,
    toolName: string,
    outcome: "completed" | "failed",
    detail: string,
  ): Promise<void> {
    try {
      await this.client.notarize({
        actionId,
        outcome,
        outcomeDetails: `Tool '${toolName}' ${outcome}: ${detail}`.slice(0, MAX_DETAILS),
      });
    } catch (e) {
      console.warn("Aira notarize failed (non-blocking):", e);
    }
  }

  /**
   * REAL GATE: wraps a tool function to gate + notarize.
   *
   * Flow:
   *   1. Call `aira.authorize()` — throws POLICY_DENIED or pending_approval.
   *   2. Run the tool.
   *   3. Call `aira.notarize()` with outcome="completed" or "failed".
   *
   * No raw user data is sent — only tool name, arg keys, and output length.
   */
  wrapTool<T extends (...args: unknown[]) => unknown>(
    toolFn: T,
    toolName?: string,
  ): T {
    const name = toolName ?? toolFn.name ?? "unknown";
    const self = this;
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const kwargs =
        args.length > 0 && typeof args[0] === "object" && args[0]
          ? (args[0] as Record<string, unknown>)
          : undefined;

      const actionId = await self.authorizeToolCall(name, kwargs);

      try {
        const result = await (toolFn as (...a: unknown[]) => Promise<unknown>).apply(this, args);
        if (actionId) {
          await self.notarizeToolResult(
            actionId,
            name,
            "completed",
            `result length ${String(result).length} chars`,
          );
        }
        return result;
      } catch (err) {
        if (actionId) {
          await self.notarizeToolResult(
            actionId,
            name,
            "failed",
            (err as Error)?.message ?? String(err),
          );
        }
        throw err;
      }
    };
    return wrapped as unknown as T;
  }
}
