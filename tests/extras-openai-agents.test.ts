import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraGuardrail } from "../src/extras/openai-agents";

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

describe("AiraGuardrail", () => {
  it("notarizes tool call with arg keys only", () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    guard.onToolCall("search", { query: "sensitive data", limit: 10 });

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_call");
    expect(call.details).toContain("search");
    expect(call.details).toContain("query");
    expect(call.details).toContain("limit");
    // Must NOT contain actual arg values
    expect(call.details).not.toContain("sensitive data");
  });

  it("notarizes tool result with length only", () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    guard.onToolResult("search", "this is the full result");

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_completed");
    expect(call.details).toContain("search");
    expect(call.details).toContain("23 chars");
    // Must NOT contain actual result
    expect(call.details).not.toContain("this is the full result");
  });

  it("includes model_id when provided", () => {
    const guard = new AiraGuardrail(mockClient, "agent-1", { modelId: "gpt-4o" });
    guard.onToolCall("tool");

    expect(mockNotarize.mock.calls[0][0].modelId).toBe("gpt-4o");
  });

  it("wrapTool auto-notarizes calls and results", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const fn = async (args: { q: string }) => `found: ${args.q}`;
    const wrapped = guard.wrapTool(fn, "search");

    const result = await wrapped({ q: "test" });
    expect(result).toBe("found: test");
    expect(mockNotarize).toHaveBeenCalledTimes(2);
    expect(mockNotarize.mock.calls[0][0].actionType).toBe("tool_call");
    expect(mockNotarize.mock.calls[1][0].actionType).toBe("tool_completed");
  });

  it("wrapTool infers tool name from function", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    async function mySearchTool() { return "ok"; }
    const wrapped = guard.wrapTool(mySearchTool);

    await wrapped();
    expect(mockNotarize.mock.calls[0][0].details).toContain("mySearchTool");
  });

  it("does not throw on notarize failure", () => {
    const failClient = { notarize: vi.fn().mockRejectedValue(new Error("boom")) } as any;
    const guard = new AiraGuardrail(failClient, "agent-1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => guard.onToolCall("tool")).not.toThrow();
    warn.mockRestore();
  });

  it("handles undefined args", () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    guard.onToolCall("tool");

    const call = mockNotarize.mock.calls[0][0];
    expect(call.details).toContain("tool");
    expect(call.details).toContain("Arg keys: []");
  });
});

describe("AiraGuardrail trust policy", () => {
  it("returns no-policy context when trustPolicy is not set", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const ctx = await guard.checkTrust("partner");

    expect(ctx.counterpartyId).toBe("partner");
    expect(ctx.blocked).toBe(false);
    expect(ctx.recommendation).toBe("No trust policy configured");
  });

  it("resolves DID and checks reputation", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, minReputation: 50 },
    });
    const ctx = await guard.checkTrust("partner");

    expect(ctx.didResolved).toBe(true);
    expect(ctx.reputationScore).toBe(85);
    expect(ctx.blocked).toBe(false);
  });

  it("blocks on revoked VC when blockRevokedVc is set", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true, blockRevokedVc: true },
    });
    const ctx = await guard.checkTrust("partner");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("revoked or invalid");
  });

  it("blocks unregistered agent when blockUnregistered is set", async () => {
    mockResolveDid.mockRejectedValueOnce(new Error("not found"));
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, blockUnregistered: true },
    });
    const ctx = await guard.checkTrust("unknown-agent");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("could not be resolved");
  });

  it("warns but does not block on low reputation", async () => {
    mockGetReputation.mockResolvedValueOnce({ score: 20, tier: "low" });
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { minReputation: 50 },
    });
    const ctx = await guard.checkTrust("partner");

    expect(ctx.blocked).toBe(false);
    expect(ctx.reputationWarning).toContain("below minimum");
  });
});
