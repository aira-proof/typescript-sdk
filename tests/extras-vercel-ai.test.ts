import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraVercelMiddleware } from "../src/extras/vercel-ai";
import { AiraError } from "../src/types";

const mockAuthorize = vi.fn();
const mockNotarize = vi.fn().mockResolvedValue({ action_uuid: "a1", status: "notarized" });
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
  mockAuthorize.mockResolvedValue({ action_uuid: "a1", status: "authorized" });
  mockNotarize.mockClear();
  mockResolveDid.mockClear();
  mockGetAgentCredential.mockClear();
  mockVerifyCredential.mockClear();
  mockGetReputation.mockClear();
});

describe("AiraVercelMiddleware — wrapTool (real gate)", () => {
  it("authorizes before calling the tool, notarizes after", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const original = async (args: { q: string }) => `result for ${args.q}`;
    const wrapped = mw.wrapTool(original, "search");

    const result = await wrapped({ q: "test" });
    expect(result).toBe("result for test");
    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockNotarize).toHaveBeenCalledOnce();

    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("tool_call");
    expect(mockAuthorize.mock.calls[0][0].details).toContain("search");
    expect(mockNotarize.mock.calls[0][0].actionId).toBe("a1");
    expect(mockNotarize.mock.calls[0][0].outcome).toBe("completed");
  });

  it("blocks tool execution on pending_approval", async () => {
    mockAuthorize.mockResolvedValueOnce({ action_uuid: "a2", status: "pending_approval" });
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");

    const original = vi.fn().mockResolvedValue("should not run");
    const wrapped = mw.wrapTool(original, "wire");

    await expect(wrapped({ amt: 100 })).rejects.toThrow(/pending human approval/);
    expect(original).not.toHaveBeenCalled();
    expect(mockNotarize).not.toHaveBeenCalled();
  });

  it("blocks tool execution on POLICY_DENIED", async () => {
    mockAuthorize.mockRejectedValueOnce(new AiraError(403, "POLICY_DENIED", "Blocked"));
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");

    const original = vi.fn().mockResolvedValue("should not run");
    const wrapped = mw.wrapTool(original, "wire");

    await expect(wrapped({ amt: 100 })).rejects.toThrow("POLICY_DENIED");
    expect(original).not.toHaveBeenCalled();
  });

  it("notarizes as failed when tool throws", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const original = async () => {
      throw new Error("tool exploded");
    };
    const wrapped = mw.wrapTool(original, "explode");

    await expect(wrapped({})).rejects.toThrow("tool exploded");
    expect(mockNotarize).toHaveBeenCalledOnce();
    expect(mockNotarize.mock.calls[0][0].outcome).toBe("failed");
    expect(mockNotarize.mock.calls[0][0].outcomeDetails).toContain("tool exploded");
  });

  it("fails open on transient errors by default", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const wrapped = mw.wrapTool(async () => "ok", "search");

    const result = await wrapped({});
    expect(result).toBe("ok");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails closed in strict mode", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network"));
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", { strict: true });
    const wrapped = mw.wrapTool(async () => "ok", "search");

    await expect(wrapped({})).rejects.toThrow();
  });

  it("includes model_id when provided", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", { modelId: "claude-4" });
    const wrapped = mw.wrapTool(async () => "ok", "t");
    await wrapped({});
    expect(mockAuthorize.mock.calls[0][0].modelId).toBe("claude-4");
  });
});

describe("AiraVercelMiddleware — audit-only callbacks", () => {
  it("onStepFinish calls authorize + notarize", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onStepFinish("tool-call", 200);
    // Allow the async void task to run
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("step_completed");
    expect(mockAuthorize.mock.calls[0][0].details).toContain("tool-call");
    expect(mockNotarize).toHaveBeenCalledOnce();
  });

  it("onFinish calls authorize + notarize", async () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    mw.onFinish("stop", 500);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("generation_completed");
    expect(mockAuthorize.mock.calls[0][0].details).toContain("stop");
  });

  it("onStepFinish is non-blocking on authorize failure", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("fail"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");

    expect(() => mw.onStepFinish("tool")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    warn.mockRestore();
  });

  it("returns Vercel AI-compatible callbacks", () => {
    const mw = new AiraVercelMiddleware(mockClient, "agent-1");
    const cbs = mw.asCallbacks();
    expect(cbs.onStepFinish).toBeTypeOf("function");
    expect(cbs.onFinish).toBeTypeOf("function");
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
  });

  it("blocks on revoked VC when blockRevokedVc is set", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const mw = new AiraVercelMiddleware(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true, blockRevokedVc: true },
    });
    const ctx = await mw.checkTrust("partner");
    expect(ctx.blocked).toBe(true);
  });
});
