import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraGuardrail } from "../src/extras/openai-agents";
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

describe("AiraGuardrail — wrapTool (real gate)", () => {
  it("authorizes before tool runs, notarizes after", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const fn = async (args: { q: string }) => `found: ${args.q}`;
    const wrapped = guard.wrapTool(fn, "search");

    const result = await wrapped({ q: "test" });
    expect(result).toBe("found: test");
    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockNotarize).toHaveBeenCalledOnce();
    expect(mockAuthorize.mock.calls[0][0].actionType).toBe("tool_call");
    expect(mockNotarize.mock.calls[0][0].actionId).toBe("a1");
    expect(mockNotarize.mock.calls[0][0].outcome).toBe("completed");
  });

  it("does not leak arg values — only keys", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const fn = async (args: { query: string; limit: number }) => "ok";
    const wrapped = guard.wrapTool(fn, "search");

    await wrapped({ query: "sensitive user data", limit: 10 });

    const authCall = mockAuthorize.mock.calls[0][0];
    expect(authCall.details).toContain("query");
    expect(authCall.details).toContain("limit");
    expect(authCall.details).not.toContain("sensitive user data");
  });

  it("blocks execution on pending_approval", async () => {
    mockAuthorize.mockResolvedValueOnce({ action_id: "a2", status: "pending_approval" });
    const guard = new AiraGuardrail(mockClient, "agent-1");

    const fn = vi.fn().mockResolvedValue("should not run");
    const wrapped = guard.wrapTool(fn, "wire");

    await expect(wrapped({ amt: 100 })).rejects.toThrow(/pending human approval/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("blocks on POLICY_DENIED", async () => {
    mockAuthorize.mockRejectedValueOnce(new AiraError(403, "POLICY_DENIED", "Blocked"));
    const guard = new AiraGuardrail(mockClient, "agent-1");

    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = guard.wrapTool(fn, "wire");

    await expect(wrapped({})).rejects.toThrow("POLICY_DENIED");
    expect(fn).not.toHaveBeenCalled();
  });

  it("notarizes as failed when tool throws", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const fn = async () => {
      throw new Error("tool exploded");
    };
    const wrapped = guard.wrapTool(fn, "explode");

    await expect(wrapped({})).rejects.toThrow("tool exploded");
    expect(mockNotarize).toHaveBeenCalledOnce();
    expect(mockNotarize.mock.calls[0][0].outcome).toBe("failed");
  });

  it("fails open on transient authorize errors by default", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const guard = new AiraGuardrail(mockClient, "agent-1");
    const wrapped = guard.wrapTool(async () => "ok", "search");

    const result = await wrapped({});
    expect(result).toBe("ok");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails closed in strict mode", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("network"));
    const guard = new AiraGuardrail(mockClient, "agent-1", { strict: true });
    const wrapped = guard.wrapTool(async () => "ok", "search");
    await expect(wrapped({})).rejects.toThrow();
  });

  it("wrapTool infers tool name from function", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    async function mySearchTool() {
      return "ok";
    }
    const wrapped = guard.wrapTool(mySearchTool);
    await wrapped();
    expect(mockAuthorize.mock.calls[0][0].details).toContain("mySearchTool");
  });

  it("includes model_id when provided", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1", { modelId: "gpt-4o" });
    const wrapped = guard.wrapTool(async () => "ok", "t");
    await wrapped({});
    expect(mockAuthorize.mock.calls[0][0].modelId).toBe("gpt-4o");
  });

  it("exposes authorizeToolCall + notarizeToolResult as public helpers", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");

    const actionId = await guard.authorizeToolCall("manual", { arg: 1 });
    expect(actionId).toBe("a1");
    expect(mockAuthorize).toHaveBeenCalledOnce();

    await guard.notarizeToolResult(actionId!, "manual", "completed", "ok");
    expect(mockNotarize).toHaveBeenCalledOnce();
  });
});

describe("AiraGuardrail trust policy", () => {
  it("returns no-policy context when trustPolicy is not set", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1");
    const ctx = await guard.checkTrust("partner");
    expect(ctx.counterpartyId).toBe("partner");
    expect(ctx.blocked).toBe(false);
  });

  it("resolves DID and checks reputation", async () => {
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, minReputation: 50 },
    });
    const ctx = await guard.checkTrust("partner");
    expect(ctx.didResolved).toBe(true);
    expect(ctx.reputationScore).toBe(85);
  });

  it("blocks on revoked VC when blockRevokedVc is set", async () => {
    mockVerifyCredential.mockResolvedValueOnce({ valid: false });
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { requireValidVc: true, blockRevokedVc: true },
    });
    const ctx = await guard.checkTrust("partner");
    expect(ctx.blocked).toBe(true);
  });

  it("blocks unregistered agent when blockUnregistered is set", async () => {
    mockResolveDid.mockRejectedValueOnce(new Error("not found"));
    const guard = new AiraGuardrail(mockClient, "agent-1", {
      trustPolicy: { verifyCounterparty: true, blockUnregistered: true },
    });
    const ctx = await guard.checkTrust("unknown-agent");
    expect(ctx.blocked).toBe(true);
  });
});
