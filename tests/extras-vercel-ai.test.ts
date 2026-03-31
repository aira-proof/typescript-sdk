import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiraVercelMiddleware } from "../src/extras/vercel-ai";

const mockNotarize = vi.fn().mockResolvedValue({ action_id: "a1" });
const mockClient = { notarize: mockNotarize } as any;

beforeEach(() => {
  mockNotarize.mockClear();
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
