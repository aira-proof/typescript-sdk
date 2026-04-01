/**
 * OpenAI Node SDK integration — guardrail that notarizes tool calls.
 *
 * Requires: openai (peer dependency)
 *
 * Usage:
 *   import { AiraGuardrail } from "aira-sdk/extras/openai-agents";
 *   const guardrail = new AiraGuardrail(aira, "my-agent");
 *   guardrail.onToolCall("search", { query: "test" });
 */

import type { Aira } from "../client";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export class AiraGuardrail {
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
  onToolCall(toolName: string, args?: Record<string, unknown>): void {
    const argKeys = Object.keys(args ?? {});
    this.notarize(
      "tool_call",
      `Tool '${toolName}' called. Arg keys: [${argKeys.join(", ")}]`,
    );
  }

  /** Call after a tool returns to notarize the result. */
  onToolResult(toolName: string, result?: unknown): void {
    this.notarize(
      "tool_completed",
      `Tool '${toolName}' completed. Result length: ${String(result).length} chars`,
    );
  }

  /**
   * Wraps a tool function to auto-notarize calls and results.
   * No raw user data is sent — only tool name, arg keys, and output length.
   */
  wrapTool<T extends (...args: unknown[]) => unknown>(
    toolFn: T,
    toolName?: string,
  ): T {
    const name = toolName ?? toolFn.name ?? "unknown";
    const self = this;
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const kwargs = args.length > 0 && typeof args[0] === "object" && args[0]
        ? (args[0] as Record<string, unknown>)
        : undefined;
      self.onToolCall(name, kwargs);
      const result = await (toolFn as Function).apply(this, args);
      self.onToolResult(name, result);
      return result;
    };
    return wrapped as unknown as T;
  }
}
