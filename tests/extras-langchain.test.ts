import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraCallbackHandler } from "../src/extras/langchain";

const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1" });
const mockResolveDid = vi.fn().mockResolvedValue({ did: "did:web:airaproof.com:agents:partner" });
const mockGetAgentCredential = vi.fn().mockResolvedValue({ type: "VerifiableCredential" });
const mockVerifyCredential = vi.fn().mockResolvedValue({ valid: true });
const mockGetReputation = vi.fn().mockResolvedValue({ score: 85, tier: "trusted" });
const mockClient = {
  notarize: mockNotarize,
  resolveDid: mockResolveDid,
  getAgentCredential: mockGetAgentCredential,
  verifyCredential: mockVerifyCredential,
  getReputation: mockGetReputation,
} as any;

beforeEach(() => {
  mockNotarize.mockClear();
  mockResolveDid.mockClear();
  mockGetAgentCredential.mockClear();
  mockVerifyCredential.mockClear();
  mockGetReputation.mockClear();
});

describe("AiraCallbackHandler", () => {
  it("notarizes tool end", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    handler.handleToolEnd("result data", "search");

    expect(mockNotarize).toHaveBeenCalledOnce();
    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_call");
    expect(call.agentId).toBe("agent-1");
    expect(call.details).toContain("search");
    expect(call.details).toContain("11 chars");
  });

  it("notarizes chain end", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    handler.handleChainEnd({ output: "data", score: 0.9 });

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("chain_completed");
    expect(call.details).toContain("output");
    expect(call.details).toContain("score");
  });

  it("notarizes LLM end", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    handler.handleLLMEnd(3);

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("llm_completion");
    expect(call.details).toContain("3");
  });

  it("includes model_id when provided", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1", { modelId: "gpt-4o" });
    handler.handleToolEnd("x", "tool");

    const call = mockNotarize.mock.calls[0][0];
    expect(call.modelId).toBe("gpt-4o");
  });

  it("uses custom action types", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      actionTypes: { tool_end: "custom_tool" },
    });
    handler.handleToolEnd("x", "tool");

    expect(mockNotarize.mock.calls[0][0].actionType).toBe("custom_tool");
  });

  it("truncates details to 5000 chars", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    handler.handleToolEnd("x", "a".repeat(6000));

    const call = mockNotarize.mock.calls[0][0];
    expect(call.details.length).toBeLessThanOrEqual(5000);
  });

  it("does not throw on notarize failure", () => {
    const failClient = { notarize: vi.fn().mockRejectedValue(new Error("fail")) } as any;
    const handler = new AiraCallbackHandler(failClient, "agent-1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => handler.handleToolEnd("x", "tool")).not.toThrow();
    warn.mockRestore();
  });

  it("returns LangChain-compatible callbacks via asCallbacks()", () => {
    const handler = new AiraCallbackHandler(mockClient, "agent-1");
    const cbs = handler.asCallbacks();

    expect(cbs.handleToolEnd).toBeTypeOf("function");
    expect(cbs.handleChainEnd).toBeTypeOf("function");
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
    expect(mockResolveDid).toHaveBeenCalledOnce();
    expect(mockGetReputation).toHaveBeenCalledOnce();
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

  it("does not block on invalid VC without blockRevokedVc", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const handler = new AiraCallbackHandler(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true },
    });
    const ctx = await handler.checkTrust("partner");

    expect(ctx.blocked).toBe(false);
    expect(ctx.vcValid).toBe(false);
    expect(ctx.recommendation).toContain("proceed with caution");
  });
});
