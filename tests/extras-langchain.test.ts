import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraCallbackHandler } from "../src/extras/langchain";

const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1" });
const mockClient = { notarize: mockNotarize } as any;

beforeEach(() => {
  mockNotarize.mockClear();
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
