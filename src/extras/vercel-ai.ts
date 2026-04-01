/**
 * Vercel AI SDK integration — middleware that notarizes tool calls and completions.
 *
 * Requires: ai (Vercel AI SDK, peer dependency)
 *
 * Usage:
 *   import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
 *   const middleware = new AiraVercelMiddleware(aira, "my-agent");
 *   // Use as wrap around tool calls or stream callbacks
 */

import type { Aira } from "../client";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export class AiraVercelMiddleware {
  private client: Aira;
  private agentId: string;
  private modelId?: string;
  private trustPolicy?: TrustPolicy;

  constructor(
    client: Aira,
    agentId: string,
    options?: { modelId?: string; trustPolicy?: TrustPolicy },
  ) {
    this.client = client;
    this.agentId = agentId;
    this.modelId = options?.modelId;
    this.trustPolicy = options?.trustPolicy;
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

  private notarize(actionType: string, details: string): void {
    try {
      const params: Record<string, unknown> = {
        actionType,
        details: details.slice(0, MAX_DETAILS),
        agentId: this.agentId,
      };
      if (this.modelId) params.modelId = this.modelId;
      this.client.notarize(params as Parameters<Aira["notarize"]>[0]).catch((e) => {
        console.warn("Aira notarize failed (non-blocking):", e);
      });
    } catch (e) {
      console.warn("Aira notarize failed (non-blocking):", e);
    }
  }

  /** Call after a tool execution to notarize it. */
  onToolCall(toolName: string, argKeys: string[] = []): void {
    this.notarize(
      "tool_call",
      `Tool '${toolName}' called. Arg keys: [${argKeys.join(", ")}]`,
    );
  }

  /** Call after a tool returns to notarize the result. */
  onToolResult(toolName: string, resultLength: number): void {
    this.notarize(
      "tool_completed",
      `Tool '${toolName}' completed. Result length: ${resultLength} chars`,
    );
  }

  /** Call when a text generation step completes. */
  onStepFinish(stepType: string, tokenCount?: number): void {
    this.notarize(
      "step_completed",
      `Step '${stepType}' completed.${tokenCount != null ? ` Tokens: ${tokenCount}` : ""}`,
    );
  }

  /** Call when the full generation completes. */
  onFinish(finishReason: string, totalTokens?: number): void {
    this.notarize(
      "generation_completed",
      `Generation completed. Reason: ${finishReason}.${totalTokens != null ? ` Total tokens: ${totalTokens}` : ""}`,
    );
  }

  /**
   * Returns a Vercel AI SDK-compatible callbacks object for streamText/generateText.
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
   * Wraps a tool's execute function to auto-notarize calls and results.
   */
  wrapTool<T extends (...args: unknown[]) => unknown>(
    toolFn: T,
    toolName: string,
  ): T {
    const self = this;
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      self.onToolCall(toolName, args.length > 0 && typeof args[0] === "object" && args[0] ? Object.keys(args[0]) : []);
      const result = await (toolFn as Function).apply(this, args);
      self.onToolResult(toolName, String(result).length);
      return result;
    };
    return wrapped as unknown as T;
  }
}
