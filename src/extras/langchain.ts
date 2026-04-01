/**
 * LangChain.js integration — auto-notarize tool and chain completions.
 *
 * Requires: @langchain/core (peer dependency)
 *
 * Usage:
 *   import { AiraCallbackHandler } from "aira-sdk/extras/langchain";
 *   const handler = new AiraCallbackHandler(aira, "my-agent");
 *   const chain = someChain.withConfig({ callbacks: [handler] });
 */

import type { Aira } from "../client";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export class AiraCallbackHandler {
  private client: Aira;
  private agentId: string;
  private modelId?: string;
  private actionTypes: Record<string, string>;
  private trustPolicy?: TrustPolicy;

  constructor(
    client: Aira,
    agentId: string,
    options?: { modelId?: string; actionTypes?: Record<string, string>; trustPolicy?: TrustPolicy },
  ) {
    this.client = client;
    this.agentId = agentId;
    this.modelId = options?.modelId;
    this.trustPolicy = options?.trustPolicy;
    this.actionTypes = {
      tool_end: "tool_call",
      chain_end: "chain_completed",
      llm_end: "llm_completion",
      ...(options?.actionTypes ?? {}),
    };
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

  /** Called when a tool finishes. */
  handleToolEnd(output: string, name = "unknown"): void {
    this.notarize(
      this.actionTypes.tool_end,
      `Tool '${name}' completed. Output length: ${String(output).length} chars`,
    );
  }

  /** Called when a chain finishes. */
  handleChainEnd(outputs: Record<string, unknown>): void {
    const keys = typeof outputs === "object" && outputs ? Object.keys(outputs) : [];
    this.notarize(
      this.actionTypes.chain_end,
      `Chain completed. Output keys: [${keys.join(", ")}]`,
    );
  }

  /** Called when an LLM finishes. */
  handleLLMEnd(generationCount: number): void {
    this.notarize(
      this.actionTypes.llm_end,
      `LLM completed. Generations: ${generationCount}`,
    );
  }

  /**
   * Returns a LangChain-compatible callbacks object.
   * Use with: chain.invoke(input, { callbacks: [handler.asCallbacks()] })
   */
  asCallbacks(): Record<string, (...args: unknown[]) => void> {
    return {
      handleToolEnd: (output: unknown, ...args: unknown[]) => {
        const runId = args[1] as string | undefined;
        const name = (args[2] as Record<string, string>)?.name ?? "unknown";
        this.handleToolEnd(String(output), name);
      },
      handleChainEnd: (outputs: unknown) => {
        this.handleChainEnd((outputs ?? {}) as Record<string, unknown>);
      },
      handleLLMEnd: (response: unknown) => {
        const resp = response as { generations?: unknown[] };
        this.handleLLMEnd(resp?.generations?.length ?? 0);
      },
    };
  }
}
