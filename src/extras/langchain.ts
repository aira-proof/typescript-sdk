/**
 * LangChain.js integration — pre-execution gate + post-execution notarize.
 *
 * Requires: @langchain/core (peer dependency)
 *
 * ---------------------------------------------------------------------------
 * LIFECYCLE & DESIGN NOTES
 * ---------------------------------------------------------------------------
 *
 * LangChain fires callbacks BEFORE and AFTER each tool/chain/LLM step. The
 * `handleToolStart` / `handleChainStart` / `handleLLMStart` callbacks are
 * genuine pre-execution hooks: if one throws, LangChain propagates the error
 * and the tool is never executed. That means `handleToolStart` can serve as
 * a real authorization gate — not merely an audit hook.
 *
 * This handler implements the two-step flow as follows:
 *
 *   1. handleToolStart  → aira.authorize()
 *       - If the backend returns "authorized" we cache the action_uuid
 *         keyed by LangChain's `runId`, then return so the tool executes.
 *       - If the backend throws POLICY_DENIED we propagate the error,
 *         which prevents the tool from running at all (real gate).
 *       - If the backend returns "pending_approval" we throw an error
 *         so the tool does NOT execute until a human approves.
 *
 *   2. handleToolEnd / handleToolError → aira.notarize()
 *       - Notarize the outcome as "completed" or "failed". This closes
 *         the two-step flow and produces a cryptographic receipt.
 *
 * The same pattern applies to chains and LLM calls. For chains and LLMs we
 * use "chain_run" / "llm_run" as action types so you can filter by them.
 *
 * If the integration cannot reach Aira at authorize time, it fails open with
 * a console warning — your agent keeps running, but no receipt is produced.
 * To make it fail closed, set `strict: true` in the options.
 */

import type { Aira } from "../client";
import type { Authorization } from "../types";
import type { TrustPolicy, TrustContext } from "./trust";
import { checkTrust } from "./trust";

export type { TrustPolicy, TrustContext } from "./trust";

const MAX_DETAILS = 5000;

export interface AiraCallbackHandlerOptions {
  modelId?: string;
  actionTypes?: Record<string, string>;
  trustPolicy?: TrustPolicy;
  /** Fail closed if authorize() fails (network, 5xx). Default: false. */
  strict?: boolean;
}

export class AiraCallbackHandler {
  private client: Aira;
  private agentId: string;
  private modelId?: string;
  private actionTypes: Record<string, string>;
  private trustPolicy?: TrustPolicy;
  private strict: boolean;
  /** runId → action_uuid cache so handleEnd can notarize the right action. */
  private inFlight: Map<string, string> = new Map();

  constructor(
    client: Aira,
    agentId: string,
    options?: AiraCallbackHandlerOptions,
  ) {
    this.client = client;
    this.agentId = agentId;
    this.modelId = options?.modelId;
    this.trustPolicy = options?.trustPolicy;
    this.strict = options?.strict ?? false;
    this.actionTypes = {
      tool: "tool_call",
      chain: "chain_run",
      llm: "llm_run",
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

  private async doAuthorize(actionType: string, details: string, runId: string): Promise<void> {
    try {
      const auth = await this.client.authorize({
        actionType,
        details: details.slice(0, MAX_DETAILS),
        agentId: this.agentId,
        modelId: this.modelId,
      });
      if (auth.status === "pending_approval") {
        // Real gate — block the tool from running until a human approves.
        const err = new Error(
          `Aira: action '${actionType}' is pending human approval (action_uuid=${auth.action_uuid}). Tool execution blocked.`,
        );
        (err as Error & { code?: string }).code = "PENDING_APPROVAL";
        throw err;
      }
      this.inFlight.set(runId, auth.action_uuid);
    } catch (e) {
      const err = e as Error & { code?: string };
      // Always propagate authorization-layer rejections.
      if (err.code === "POLICY_DENIED" || err.code === "PENDING_APPROVAL") throw e;
      if (this.strict) throw e;
      console.warn("Aira authorize failed (fail-open):", err);
    }
  }

  private async doNotarize(runId: string, outcome: "completed" | "failed", details: string): Promise<void> {
    const actionId = this.inFlight.get(runId);
    if (!actionId) return;
    this.inFlight.delete(runId);
    try {
      await this.client.notarize({
        actionId,
        outcome,
        outcomeDetails: details.slice(0, MAX_DETAILS),
      });
    } catch (e) {
      console.warn("Aira notarize failed (non-blocking):", e);
    }
  }

  /** Called BEFORE a tool runs — authorization gate. */
  async handleToolStart(
    tool: { name?: string } | string | unknown,
    input: string,
    runId: string,
  ): Promise<void> {
    const name = typeof tool === "string" ? tool : (tool as { name?: string })?.name ?? "unknown";
    await this.doAuthorize(
      this.actionTypes.tool,
      `Tool '${name}' invoked. Input length: ${String(input).length} chars`,
      runId,
    );
  }

  /** Called AFTER a tool completes successfully. */
  async handleToolEnd(output: string, runId: string, name = "unknown"): Promise<void> {
    await this.doNotarize(
      runId,
      "completed",
      `Tool '${name}' completed. Output length: ${String(output).length} chars`,
    );
  }

  /** Called if a tool throws. */
  async handleToolError(err: Error, runId: string, name = "unknown"): Promise<void> {
    await this.doNotarize(
      runId,
      "failed",
      `Tool '${name}' failed: ${err?.message ?? String(err)}`,
    );
  }

  /** Called BEFORE a chain runs. */
  async handleChainStart(
    chain: { name?: string } | unknown,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<void> {
    const name = (chain as { name?: string })?.name ?? "chain";
    const keys = typeof inputs === "object" && inputs ? Object.keys(inputs) : [];
    await this.doAuthorize(
      this.actionTypes.chain,
      `Chain '${name}' started. Input keys: [${keys.join(", ")}]`,
      runId,
    );
  }

  /** Called AFTER a chain completes. */
  async handleChainEnd(outputs: Record<string, unknown>, runId: string): Promise<void> {
    const keys = typeof outputs === "object" && outputs ? Object.keys(outputs) : [];
    await this.doNotarize(
      runId,
      "completed",
      `Chain completed. Output keys: [${keys.join(", ")}]`,
    );
  }

  /** Called if a chain throws. */
  async handleChainError(err: Error, runId: string): Promise<void> {
    await this.doNotarize(runId, "failed", `Chain failed: ${err?.message ?? String(err)}`);
  }

  /** Called BEFORE an LLM runs. */
  async handleLLMStart(llm: unknown, prompts: string[], runId: string): Promise<void> {
    await this.doAuthorize(
      this.actionTypes.llm,
      `LLM called with ${prompts?.length ?? 0} prompt(s)`,
      runId,
    );
  }

  /** Called AFTER an LLM completes. */
  async handleLLMEnd(response: { generations?: unknown[] } | number, runId: string): Promise<void> {
    const count = typeof response === "number" ? response : response?.generations?.length ?? 0;
    await this.doNotarize(runId, "completed", `LLM completed. Generations: ${count}`);
  }

  /** Called if an LLM throws. */
  async handleLLMError(err: Error, runId: string): Promise<void> {
    await this.doNotarize(runId, "failed", `LLM failed: ${err?.message ?? String(err)}`);
  }

  /**
   * Returns a LangChain-compatible callbacks object.
   * Use with: chain.invoke(input, { callbacks: [handler.asCallbacks()] })
   */
  asCallbacks(): Record<string, (...args: unknown[]) => Promise<void> | void> {
    return {
      handleToolStart: (tool: unknown, input: unknown, runId: unknown) =>
        this.handleToolStart(tool, String(input ?? ""), String(runId ?? "")),
      handleToolEnd: (output: unknown, runId: unknown, ...rest: unknown[]) => {
        const meta = rest[1] as { name?: string } | undefined;
        return this.handleToolEnd(String(output), String(runId ?? ""), meta?.name ?? "unknown");
      },
      handleToolError: (err: unknown, runId: unknown) =>
        this.handleToolError(err as Error, String(runId ?? "")),
      handleChainStart: (chain: unknown, inputs: unknown, runId: unknown) =>
        this.handleChainStart(chain, (inputs ?? {}) as Record<string, unknown>, String(runId ?? "")),
      handleChainEnd: (outputs: unknown, runId: unknown) =>
        this.handleChainEnd((outputs ?? {}) as Record<string, unknown>, String(runId ?? "")),
      handleChainError: (err: unknown, runId: unknown) =>
        this.handleChainError(err as Error, String(runId ?? "")),
      handleLLMStart: (llm: unknown, prompts: unknown, runId: unknown) =>
        this.handleLLMStart(llm, (prompts as string[]) ?? [], String(runId ?? "")),
      handleLLMEnd: (response: unknown, runId: unknown) =>
        this.handleLLMEnd(
          response as { generations?: unknown[] } | number,
          String(runId ?? ""),
        ),
      handleLLMError: (err: unknown, runId: unknown) =>
        this.handleLLMError(err as Error, String(runId ?? "")),
    };
  }
}
