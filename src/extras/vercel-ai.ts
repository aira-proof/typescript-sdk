/**
 * Vercel AI SDK integration — pre-execution gate via tool wrapping.
 *
 * Requires: ai (Vercel AI SDK, peer dependency)
 *
 * ---------------------------------------------------------------------------
 * LIFECYCLE & DESIGN NOTES
 * ---------------------------------------------------------------------------
 *
 * Vercel AI SDK exposes two integration points:
 *
 *   1. `onStepFinish` / `onFinish` callbacks on `generateText` / `streamText`
 *      — these fire AFTER each step or after the whole generation completes.
 *      They are post-hoc only; they cannot block a tool from running.
 *
 *   2. The per-tool `execute` function (user code) — this runs BEFORE the
 *      model sees the tool result. Wrapping it is the only place where we
 *      can synchronously gate execution.
 *
 * Therefore the `wrapTool()` method is the real authorization gate: it calls
 * `aira.authorize()` before invoking the underlying tool and `aira.notarize()`
 * after. If authorize returns `pending_approval` we throw so the tool does
 * NOT run; the model will see the tool result as an error and react
 * accordingly (typically by stopping or asking the user).
 *
 * The `onStepFinish` / `onFinish` helpers below are AUDIT-ONLY: they cannot
 * gate execution (Vercel AI has no pre-step hook), and they run after the
 * tool has already executed. They produce receipts for the overall
 * generation as an audit trail, not as an authorization boundary.
 */

import type { Aira } from "../client";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export interface AiraVercelMiddlewareOptions {
  modelId?: string;
  trustPolicy?: TrustPolicy;
  /** Fail closed if authorize() fails (network, 5xx). Default: false. */
  strict?: boolean;
}

export class AiraVercelMiddleware {
  private client: Aira;
  private agentId: string;
  private modelId?: string;
  private trustPolicy?: TrustPolicy;
  private strict: boolean;

  constructor(
    client: Aira,
    agentId: string,
    options?: AiraVercelMiddlewareOptions,
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
   * AUDIT-ONLY: log a post-hoc receipt for a generation step.
   * Vercel AI has no pre-step hook; this cannot gate execution.
   */
  private async auditFinish(
    actionType: string,
    details: string,
  ): Promise<void> {
    try {
      const auth = await this.client.authorize({
        actionType,
        details: details.slice(0, MAX_DETAILS),
        agentId: this.agentId,
        modelId: this.modelId,
      });
      if (auth.status === "authorized") {
        await this.client.notarize({ actionId: auth.action_id, outcome: "completed" });
      }
      // If pending_approval — just leave it; nothing to execute for audit-only.
    } catch (e) {
      console.warn("Aira audit failed (non-blocking):", e);
    }
  }

  /**
   * AUDIT-ONLY: called after a step finishes.
   * Cannot block the step — it has already run.
   */
  onStepFinish(stepType: string, tokenCount?: number): void {
    void this.auditFinish(
      "step_completed",
      `Step '${stepType}' completed.${tokenCount != null ? ` Tokens: ${tokenCount}` : ""}`,
    );
  }

  /**
   * AUDIT-ONLY: called after full generation finishes.
   */
  onFinish(finishReason: string, totalTokens?: number): void {
    void this.auditFinish(
      "generation_completed",
      `Generation completed. Reason: ${finishReason}.${totalTokens != null ? ` Total tokens: ${totalTokens}` : ""}`,
    );
  }

  /**
   * Returns a Vercel AI SDK-compatible callbacks object for streamText/generateText.
   * These callbacks are AUDIT-ONLY and cannot gate execution.
   *
   * Usage:
   *   const result = await streamText({ ...opts, ...middleware.asCallbacks() });
   */
  asCallbacks(): Record<string, (...args: unknown[]) => void> {
    return {
      onStepFinish: (step: unknown) => {
        const s = step as { stepType?: string; usage?: { totalTokens?: number } };
        this.onStepFinish(s?.stepType ?? "unknown", s?.usage?.totalTokens);
      },
      onFinish: (result: unknown) => {
        const r = result as { finishReason?: string; usage?: { totalTokens?: number } };
        this.onFinish(r?.finishReason ?? "unknown", r?.usage?.totalTokens);
      },
    };
  }

  /**
   * REAL GATE: wraps a tool's execute function so that:
   *   1. `aira.authorize()` runs BEFORE the tool — throws on POLICY_DENIED
   *      or pending_approval, which prevents the tool from executing.
   *   2. If authorized, the tool runs.
   *   3. `aira.notarize()` runs AFTER, with outcome "completed" or "failed".
   *
   * This is the recommended integration point for Vercel AI because it's
   * the only place where pre-execution gating is possible.
   */
  wrapTool<T extends (...args: unknown[]) => unknown>(
    toolFn: T,
    toolName: string,
  ): T {
    const self = this;
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const argKeys =
        args.length > 0 && typeof args[0] === "object" && args[0]
          ? Object.keys(args[0] as Record<string, unknown>)
          : [];

      let actionId: string | null = null;
      try {
        const auth = await self.client.authorize({
          actionType: "tool_call",
          details: `Tool '${toolName}' called. Arg keys: [${argKeys.join(", ")}]`.slice(0, MAX_DETAILS),
          agentId: self.agentId,
          modelId: self.modelId,
        });
        if (auth.status === "pending_approval") {
          const err = new Error(
            `Aira: tool '${toolName}' is pending human approval (action_id=${auth.action_id}). Tool execution blocked.`,
          );
          (err as Error & { code?: string }).code = "PENDING_APPROVAL";
          throw err;
        }
        actionId = auth.action_id;
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "POLICY_DENIED" || err.code === "PENDING_APPROVAL") throw e;
        if (self.strict) throw e;
        console.warn("Aira authorize failed (fail-open):", err);
      }

      try {
        const result = await (toolFn as (...a: unknown[]) => Promise<unknown>).apply(this, args);
        if (actionId) {
          await self.client.notarize({
            actionId,
            outcome: "completed",
            outcomeDetails: `Tool '${toolName}' completed. Result length: ${String(result).length} chars`.slice(0, MAX_DETAILS),
          }).catch((e) => console.warn("Aira notarize failed (non-blocking):", e));
        }
        return result;
      } catch (err) {
        if (actionId) {
          await self.client.notarize({
            actionId,
            outcome: "failed",
            outcomeDetails: `Tool '${toolName}' failed: ${(err as Error)?.message ?? String(err)}`.slice(0, MAX_DETAILS),
          }).catch((e) => console.warn("Aira notarize failed (non-blocking):", e));
        }
        throw err;
      }
    };
    return wrapped as unknown as T;
  }
}
