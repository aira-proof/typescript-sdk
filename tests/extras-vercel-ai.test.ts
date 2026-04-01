import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraVercelMiddleware } from "../src/extras/vercel-ai";

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

describe("AiraVercelMiddleware", () => {
  it("notarizes tool call", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onToolCall("search", ["query", "limit"]);

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_call");
    expect(call.details).toContain("search");
    expect(call.details).toContain("query");
  });

  it("notarizes tool result", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onToolResult("search", 150);

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("tool_completed");
    expect(call.details).toContain("150 chars");
  });

  it("notarizes step finish", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onStepFinish("tool-call", 200);

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("step_completed");
    expect(call.details).toContain("tool-call");
    expect(call.details).toContain("200");
  });

  it("notarizes generation finish", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onFinish("stop", 500);

    const call = mockNotarize.mock.calls[0][0];
    expect(call.actionType).toBe("generation_completed");
    expect(call.details).toContain("stop");
    expect(call.details).toContain("500");
  });

  it("includes model_id when provided", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", { modelId: "claude-4" });
    mw.onFinish("stop");

    expect(mockNotarize.mock.calls[0][0].modelId).toBe("claude-4");
  });

  it("returns Vercel AI-compatible callbacks", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const cbs = mw.asCallbacks();

    expect(cbs.onStepFinish).toBeTypeOf("function");
    expect(cbs.onFinish).toBeTypeOf("function");
  });

  it("wrapTool auto-notarizes", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const original = async (args: { q: string }) => `result for ${args.q}`;
    const wrapped = mw.wrapTool(original, "search");

    const result = await wrapped({ q: "test" });
    expect(result).toBe("result for test");
    expect(mockNotarize).toHaveBeenCalledTimes(2); // call + result
  });

  it("does not throw on notarize failure", () => {
    const failClient = { notarize: vi.fn().mockRejectedValue(new Error("fail")) } as any;
    const mw = new AiraVercelMiddleware(failClient, "agent-1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => mw.onToolCall("tool")).not.toThrow();
    warn.mockRestore();
  });
});

describe("AiraVercelMiddleware trust policy", () => {
  it("returns no-policy context when trustPolicy is not set", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const ctx = await mw.checkTrust("partner");

    expect(ctx.counterpartyId).toBe("partner");
    expect(ctx.blocked).toBe(false);
    expect(ctx.recommendation).toBe("No trust policy configured");
  });

  it("resolves DID and checks reputation", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, minReputation: 50 },
    });
    const ctx = await mw.checkTrust("partner");

    expect(ctx.didResolved).toBe(true);
    expect(ctx.reputationScore).toBe(85);
    expect(ctx.blocked).toBe(false);
  });

  it("blocks on revoked VC when blockRevokedVc is set", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true, blockRevokedVc: true },
    });
    const ctx = await mw.checkTrust("partner");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("revoked or invalid");
  });

  it("blocks unregistered agent when blockUnregistered is set", async () => {
    mockResolveDid.mockRejectedValueOnce(new Error("not found"));
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, blockUnregistered: true },
    });
    const ctx = await mw.checkTrust("unknown-agent");

    expect(ctx.blocked).toBe(true);
    expect(ctx.blockReason).toContain("could not be resolved");
  });
});
