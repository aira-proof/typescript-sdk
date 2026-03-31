import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraGuardrail } from "../src/extras/openai-agents";

const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1" });
const mockClient = { notarize: mockNotarize } as any;

beforeEach(() => {
  mockNotarize.mockClear();
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
