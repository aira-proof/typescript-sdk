import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira } from "../src/client";
import { AiraSession } from "../src/session";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
  };
}

const receipt = {
  action_id: "act-1",
  payload_hash: "sha256:abc",
  signature: "ed25519:xyz",
  receipt_id: "rct-1",
  action_type: "test",
  agent_id: "agent-1",
  created_at: "2026-01-01",
};

let aira: Aira;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(mockResponse(201, receipt));
  aira = new Aira({ apiKey: "aira_test_xxx" });
});

describe("AiraSession", () => {
  it("creates session via client.session()", () => {
    const session = aira.session("agent-1");
    expect(session).toBeInstanceOf(AiraSession);
  });

  it("session.notarize merges agent_id", async () => {
    const session = aira.session("agent-1");
    await session.notarize({ actionType: "email_sent", details: "Sent email" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-1");
    expect(body.action_type).toBe("email_sent");
  });

  it("session.notarize merges default model_id", async () => {
    const session = aira.session("agent-1", { modelId: "gpt-4o" });
    await session.notarize({ actionType: "test", details: "d" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-1");
    expect(body.model_id).toBe("gpt-4o");
  });

  it("session.notarize allows overriding defaults", async () => {
    const session = aira.session("agent-1", { modelId: "gpt-4o" });
    await session.notarize({ actionType: "test", details: "d", modelId: "claude-4" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("claude-4");
  });

  it("session returns ActionReceipt", async () => {
    const session = aira.session("agent-1");
    const result = await session.notarize({ actionType: "test", details: "d" });

    expect(result.action_id).toBe("act-1");
    expect(result.signature).toBe("ed25519:xyz");
  });
});

describe("AiraSession constructed directly", () => {
  it("works when constructed with new", async () => {
    const session = new AiraSession(aira, "agent-2");
    await session.notarize({ actionType: "test", details: "d" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-2");
  });
});
