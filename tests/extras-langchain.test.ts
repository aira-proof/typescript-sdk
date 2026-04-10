import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraCallbackHandler } from "../src/extras/langchain";
import { AiraError } from "../src/types";

const mockAuthorize = vi.fn();
const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1", status: "notarized" });
const mockResolveDid = vi.fn().mockResolvedValue({ did: "did:web:airaproof.com:agents:partner" });
const mockGetAgentCredential = vi.fn().mockResolvedValue({ type: "VerifiableCredential" });
const mockVerifyCredential = vi.fn().mockResolvedValue({ valid: true });
const mockGetReputation = vi.fn().mockResolvedValue({ score: 85, tier: "trusted" });
const mockClient = {
  authorize: mockAuthorize,
  notarize: mockNotarize,
  resolveDid: mockResolveDid,
  getAgentCredential: mockGetAgentCredential,
  verifyCredential: mockVerifyCredential,
  getReputation: mockGetReputation,
} as any;

beforeEach(() => {
  mockAuthorize.mockReset();
  mockAuthorize.mockResolvedValue({ action_id: "a1", status: "authorized" });
  mockNotarize.mockClear();
  mockResolveDid.mockClear();
  mockGetAgentCredential.mockClear();
  mockVerifyCredential.mockClear();
  mockGetReputation.mockClear();
});

describe("AiraCallbackHandler — pre-execution gate", () => {
  it("authorizes on handleToolStart", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleToolStart({ name: "search" }, "query input", "run-1");

    expect(mockAuthorize).toHaveBeenCalledOnce();
    const call = mockAuthorize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_call");
    expect(call.agentId).toBe("agent-1");
    expect(call.details).toContain("search");
  });

  it("notarizes on handleToolEnd with the cached action_id", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleToolStart({ name: "search" }, "q", "run-42");
    await handler.handleToolEnd("result output", "run-42", "search");

    expect(mockNotarize).toHaveBeenCalledOnce();
    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionId).toBe("a1");
    expect(call.outcome).toBe("completed");
    expect(call.outcomeDetails).toContain("search");
  });

  it("notarizes as failed on handleToolError", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleToolStart({ name: "search" }, "q", "run-9");
    await handler.handleToolError(new Error("boom"), "run-9", "search");

    const call = mockNotarize.mock.calls[0][0];
    expect(call.outcome).toBe("failed");
    expect(call.outcomeDetails).toContain("boom");
  });

  it("blocks execution on pending_approval", async () => {
    mockAuthorize.mockResolvedValueOnce({ action_id: "a2", status: "pending_approval" });
    const handler = new AiraCallbackHandler(mockClient, "agent-1");

    await expect(
      handler.handleToolStart({ name: "wire" }, "send", "run-5"),
    ).rejects.toThrow(/pending human approval/);

    // Tool end should not notarize — nothing was cached
    await handler.handleToolEnd("result", "run-5", "wire");
    expect(mockNotarize).not.toHaveBeenCalled();
  });

  it("rethrows POLICY_DENIED errors from authorize", async () => {
    const err = new AiraError(403, "POLICY_DENIED", "Blocked");
    mockAuthorize.mockRejectedValueOnce(err);

    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await expect(
      handler.handleToolStart({ name: "wire" }, "send", "run-6"),
    ).rejects.toThrow("POLICY_DENIED");
  });

  it("fails open on transient errors by default", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network timeout"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await expect(
      handler.handleToolStart({ name: "search" }, "q", "run-7"),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails closed in strict mode", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network timeout"));

    const handler = new AiraCallbackHandler(mockClient, "agent-1", { strict: true });
    await expect(
      handler.handleToolStart({ name: "search" }, "q", "run-8"),
    ).rejects.toThrow();
  });

  it("gates chains via handleChainStart / handleChainEnd", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleChainStart({ name: "rag" }, { query: "x" }, "run-c1");
    await handler.handleChainEnd({ output: "done" }, "run-c1");

    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockNotarize).toHaveBeenCalledOnce();
    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("chain_run");
    expect(mockNotarize.mock.calls[0][0].outcome).toBe("completed");
  });

  it("gates LLM calls via handleLLMStart / handleLLMEnd", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleLLMStart({}, ["prompt 1", "prompt 2"], "run-l1");
    await handler.handleLLMEnd({ generations: [1, 2] }, "run-l1");

    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("llm_run");
    expect(mockNotarize).toHaveBeenCalledOnce();
  });

  it("includes model_id when provided", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1", { modelId: "gpt-4o" });
    await handler.handleToolStart({ name: "t" }, "x", "run-m");
    expect(mockAuthorize.mock.calls[0][0].modelId).toBe("gpt-4o");
  });

  it("uses custom action types", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      actionTypes: { tool: "custom_tool" },
    });
    await handler.handleToolStart({ name: "t" }, "x", "run-ct");
    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("custom_tool");
  });

  it("truncates long details", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    await handler.handleToolStart({ name: "a".repeat(6000) }, "q", "run-t");
    const call = mockAuthorize.mock.calls[0][0];
    expect(call.details.length).toBeLessThanOrEqual(5000);
  });

  it("returns LangChain-compatible callbacks via asCallbacks()", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    const cbs = handler.asCallbacks();
    expect(cbs.handleToolStart).toBeTypeOf("function");
    expect(cbs.handleToolEnd).toBeTypeOf("function");
    expect(cbs.handleToolError).toBeTypeOf("function");
    expect(cbs.handleChainStart).toBeTypeOf("function");
    expect(cbs.handleChainEnd).toBeTypeOf("function");
    expect(cbs.handleLLMStart).toBeTypeOf("function");
    expect(cbs.handleLLMEnd).toBeTypeOf("function");
  });
});

describe("AiraCallbackHandler trust policy", () => {
  it("returns no-policy context when trustPolicy is not set", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    const ctx = await handler.checkTrust("partner");

    expect(ctx.counterpartyId).toBe("partner");
    expect(ctx.blocked).toBe(false);
    expect(ctx.recommendation).toBe("No trust policy configured");
  });

  it("resolves DID and checks reputation with verifyCounterparty", async () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, minReputation: 50 },
    });
    const ctx = await handler.checkTrust("partner");

    expect(ctx.didResolved).toBe(true);
    expect(ctx.reputationScore).toBe(85);
    expect(ctx.blocked).toBe(false);
  });

  it("warns when reputation is below minimum", async () => {
    mockGetReputation.mockResolvedValueOnce({ score: 20, tier: "low" });
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      trustPolicy: { minReputation: 50 },
    });
    const ctx = await handler.checkTrust("partner");

    expect(ctx.blocked).toBe(false);
    expect(ctx.reputationWarning).toContain("below minimum");
  });

  it("blocks on revoked VC when blockRevokedVc is set", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true, blockRevokedVc: true },
    });
    const ctx = await handler.checkTrust("partner");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("revoked or invalid");
  });

  it("blocks unregistered agent when blockUnregistered is set", async () => {
    mockResolveDid.mockRejectedValueOnce(new Error("not found"));
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, blockUnregistered: true },
    });
    const ctx = await handler.checkTrust("unknown-agent");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("could not be resolved");
  });
});
