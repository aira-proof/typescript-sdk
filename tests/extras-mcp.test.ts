import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTools, handleToolCall, createServer } from "../src/extras/mcp";

const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1", signature: "ed25519:abc" });
const mockVerifyAction = vi.fn().mockResolvedValue({ valid: true, message: "OK" });
const mockGetReceipt = vi.fn().mockResolvedValue({ receipt_id: "r1", signature: "ed25519:xyz" });

const mockClient = {
  notarize: mockNotarize,
  verifyAction: mockVerifyAction,
  getReceipt: mockGetReceipt,
} as any;

beforeEach(() => {
  mockNotarize.mockClear();
  mockVerifyAction.mockClear();
  mockGetReceipt.mockClear();
});

describe("MCP tools", () => {
  it("getTools returns 3 tools", () => {
    const tools = getTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["notarize_action", "verify_action", "get_receipt"]);
  });

  it("each tool has name, description, and inputSchema", () => {
    for (const tool of getTools()) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("handleToolCall", () => {
  it("handles notarize_action", async () => {
    const result = await handleToolCall(mockClient, "notarize_action", {
      action_type: "email_sent",
      details: "Sent email",
      agent_id: "agent-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(JSON.parse(result[0].text)).toHaveProperty("action_id", "a1");
    expect(mockNotarize).toHaveBeenCalledWith({
      actionType: "email_sent",
      details: "Sent email",
      agentId: "agent-1",
      modelId: undefined,
    });
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
    mockNotarize.mockRejectedValueOnce(new Error("API down"));
    const result = await handleToolCall(mockClient, "notarize_action", {
      action_type: "test",
      details: "test",
    });

    expect(JSON.parse(result[0].text)).toHaveProperty("error");
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
    expect(result.tools).toHaveLength(3);
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
