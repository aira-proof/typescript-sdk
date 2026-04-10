import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTools, handleToolCall, createServer } from "../src/extras/mcp";

const mockAuthorize = vi.fn().mockResolvedValue({
  action_id: "a1",
  status: "authorized",
  created_at: "2026-04-07T00:00:00Z",
  request_id: "req-1",
  warnings: null,
});
const mockNotarize = vi.fn().mockResolvedValue({
  action_id: "a1",
  status: "notarized",
  receipt_id: "r1",
  signature: "ed25519:abc",
  payload_hash: "sha256:abc",
  timestamp_token: null,
  created_at: "2026-04-07T00:00:01Z",
  request_id: "req-2",
  warnings: null,
});
const mockGetAction = vi.fn().mockResolvedValue({ action_id: "a1", action_type: "test" });
const mockVerifyAction = vi.fn().mockResolvedValue({ valid: true, message: "OK" });
const mockGetReceipt = vi.fn().mockResolvedValue({ receipt_id: "r1", signature: "ed25519:xyz" });
const mockResolveDid = vi.fn().mockResolvedValue({
  did: "did:web:airaproof.com:agents:partner",
  document: {},
});
const mockGetAgentCredential = vi.fn().mockResolvedValue({
  type: "VerifiableCredential",
  issuer: "aira",
});
const mockVerifyCredential = vi.fn().mockResolvedValue({
  valid: true,
  checks: ["signature", "expiry", "revocation"],
});
const mockGetReputation = vi.fn().mockResolvedValue({
  score: 85,
  tier: "trusted",
  total_attestations: 12,
});
const mockRequestMutualSign = vi.fn().mockResolvedValue({ status: "pending", action_id: "a1" });

const mockClient = {
  authorize: mockAuthorize,
  notarize: mockNotarize,
  getAction: mockGetAction,
  verifyAction: mockVerifyAction,
  getReceipt: mockGetReceipt,
  resolveDid: mockResolveDid,
  getAgentCredential: mockGetAgentCredential,
  verifyCredential: mockVerifyCredential,
  getReputation: mockGetReputation,
  requestMutualSign: mockRequestMutualSign,
} as any;

beforeEach(() => {
  mockAuthorize.mockClear();
  mockNotarize.mockClear();
  mockGetAction.mockClear();
  mockVerifyAction.mockClear();
  mockGetReceipt.mockClear();
  mockResolveDid.mockClear();
  mockGetAgentCredential.mockClear();
  mockVerifyCredential.mockClear();
  mockGetReputation.mockClear();
  mockRequestMutualSign.mockClear();
});

describe("MCP tools", () => {
  it("getTools exposes authorize_action and notarize_action as separate tools", () => {
    const tools = getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("authorize_action");
    expect(names).toContain("notarize_action");
    expect(names).toContain("get_action");
    expect(names).toContain("verify_action");
    expect(names).toContain("get_receipt");
  });

  it("each tool has name, description, and inputSchema", () => {
    for (const tool of getTools()) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("authorize_action requires action_type and details", () => {
    const tool = getTools().find((t) => t.name === "authorize_action")!;
    const required = tool.inputSchema.required as string[];
    expect(required).toContain("action_type");
    expect(required).toContain("details");
  });

  it("notarize_action requires action_id", () => {
    const tool = getTools().find((t) => t.name === "notarize_action")!;
    const required = tool.inputSchema.required as string[];
    expect(required).toContain("action_id");
  });
});

describe("handleToolCall", () => {
  it("handles authorize_action", async () => {
    const result = await handleToolCall(mockClient, "authorize_action", {
      action_type: "email_sent",
      details: "Sent email",
      agent_id: "agent-1",
    });

    const parsed = JSON.parse(result[0].text);
    expect(parsed.action_id).toBe("a1");
    expect(parsed.status).toBe("authorized");
    expect(mockAuthorize).toHaveBeenCalledWith({
      actionType: "email_sent",
      details: "Sent email",
      agentId: "agent-1",
      modelId: undefined,
      requireApproval: undefined,
      approvers: undefined,
    });
  });

  it("handles authorize_action with require_approval", async () => {
    await handleToolCall(mockClient, "authorize_action", {
      action_type: "wire_transfer",
      details: "Send $1M",
      require_approval: true,
      approvers: ["manager@example.com"],
    });

    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        requireApproval: true,
        approvers: ["manager@example.com"],
      }),
    );
  });

  it("handles notarize_action with completed outcome", async () => {
    const result = await handleToolCall(mockClient, "notarize_action", {
      action_id: "a1",
      outcome: "completed",
      outcome_details: "Sent successfully",
    });

    const parsed = JSON.parse(result[0].text);
    expect(parsed.status).toBe("notarized");
    expect(parsed.signature).toBe("ed25519:abc");
    expect(mockNotarize).toHaveBeenCalledWith({
      actionId: "a1",
      outcome: "completed",
      outcomeDetails: "Sent successfully",
    });
  });

  it("handles notarize_action with failed outcome", async () => {
    await handleToolCall(mockClient, "notarize_action", {
      action_id: "a1",
      outcome: "failed",
      outcome_details: "Rejected by bank",
    });

    expect(mockNotarize).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", outcomeDetails: "Rejected by bank" }),
    );
  });

  it("defaults notarize_action outcome to completed", async () => {
    await handleToolCall(mockClient, "notarize_action", { action_id: "a1" });
    expect(mockNotarize).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed" }),
    );
  });

  it("handles get_action", async () => {
    const result = await handleToolCall(mockClient, "get_action", { action_id: "a1" });
    expect(JSON.parse(result[0].text)).toHaveProperty("action_id", "a1");
    expect(mockGetAction).toHaveBeenCalledWith("a1");
  });

  it("handles verify_action", async () => {
    const result = await handleToolCall(mockClient, "verify_action", { action_id: "act-1" });
    expect(JSON.parse(result[0].text)).toHaveProperty("valid", true);
    expect(mockVerifyAction).toHaveBeenCalledWith("act-1");
  });

  it("handles get_receipt", async () => {
    const result = await handleToolCall(mockClient, "get_receipt", { receipt_id: "r1" });
    expect(JSON.parse(result[0].text)).toHaveProperty("receipt_id", "r1");
    expect(mockGetReceipt).toHaveBeenCalledWith("r1");
  });

  it("returns error for unknown tool", async () => {
    const result = await handleToolCall(mockClient, "unknown_tool", {});
    expect(JSON.parse(result[0].text)).toHaveProperty("error");
    expect(JSON.parse(result[0].text).error).toContain("Unknown tool");
  });

  it("returns error on exception", async () => {
    mockAuthorize.mockRejectedValueOnce(new Error("API down"));
    const result = await handleToolCall(mockClient, "authorize_action", {
      action_type: "test",
      details: "test",
    });
    expect(JSON.parse(result[0].text)).toHaveProperty("error");
  });

  it("handles resolve_did", async () => {
    const result = await handleToolCall(mockClient, "resolve_did", {
      did: "did:web:airaproof.com:agents:partner",
    });
    expect(JSON.parse(result[0].text)).toHaveProperty("did");
    expect(mockResolveDid).toHaveBeenCalledWith("did:web:airaproof.com:agents:partner");
  });

  it("handles verify_credential", async () => {
    const result = await handleToolCall(mockClient, "verify_credential", {
      agent_id: "partner",
    });
    expect(JSON.parse(result[0].text)).toHaveProperty("valid", true);
    expect(mockGetAgentCredential).toHaveBeenCalledWith("partner");
  });

  it("handles get_reputation", async () => {
    const result = await handleToolCall(mockClient, "get_reputation", {
      agent_id: "partner",
    });
    const parsed = JSON.parse(result[0].text);
    expect(parsed).toHaveProperty("score", 85);
  });

  it("handles request_mutual_sign", async () => {
    const result = await handleToolCall(mockClient, "request_mutual_sign", {
      action_id: "a1",
      counterparty_did: "did:web:airaproof.com:agents:partner",
    });
    expect(JSON.parse(result[0].text)).toHaveProperty("status", "pending");
  });
});

describe("createServer", () => {
  it("returns listTools and callTool handlers", () => {
    const server = createServer(mockClient);
    expect(server.listTools).toBeTypeOf("function");
    expect(server.callTool).toBeTypeOf("function");
  });

  it("listTools returns tools array", async () => {
    const server = createServer(mockClient);
    const result = await server.listTools();
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it("callTool delegates to handleToolCall", async () => {
    const server = createServer(mockClient);
    const result = await server.callTool({
      params: { name: "verify_action", arguments: { action_id: "act-1" } },
    });
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toHaveProperty("valid", true);
  });
});
