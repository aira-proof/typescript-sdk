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

const authResponse = {
  action_id: "act-1",
  status: "authorized",
  created_at: "2026-04-07T00:00:00Z",
  request_id: "req-1",
  warnings: null,
};

const receiptResponse = {
  action_id: "act-1",
  status: "notarized",
  created_at: "2026-04-07T00:00:01Z",
  request_id: "req-2",
  receipt_id: "rct-1",
  payload_hash: "sha256:abc",
  signature: "ed25519:xyz",
  timestamp_token: null,
  warnings: null,
};

let aira: Aira;

beforeEach(() => {
  mockFetch.mockReset();
  aira = new Aira({ apiKey: "aira_test_xxx" });
});

describe("AiraSession", () => {
  it("creates session via client.session()", () => {
    const session = aira.session("agent-1");
    expect(session).toBeInstanceOf(AiraSession);
  });

  it("session.authorize merges agent_id", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, authResponse));
    const session = aira.session("agent-1");
    await session.authorize({ actionType: "email_sent", details: "Sent email" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-1");
    expect(body.action_type).toBe("email_sent");
  });

  it("session.authorize merges default model_id", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, authResponse));
    const session = aira.session("agent-1", { modelId: "gpt-4o" });
    await session.authorize({ actionType: "test", details: "d" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-1");
    expect(body.model_id).toBe("gpt-4o");
  });

  it("session.authorize allows overriding defaults", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, authResponse));
    const session = aira.session("agent-1", { modelId: "gpt-4o" });
    await session.authorize({ actionType: "test", details: "d", modelId: "claude-4" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("claude-4");
  });

  it("session.authorize returns Authorization", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, authResponse));
    const session = aira.session("agent-1");
    const auth = await session.authorize({ actionType: "test", details: "d" });

    expect(auth.action_id).toBe("act-1");
    expect(auth.status).toBe("authorized");
  });

  it("session.notarize passes through to client", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, receiptResponse));
    const session = aira.session("agent-1");
    const receipt = await session.notarize({ actionId: "act-1", outcome: "completed" });

    expect(receipt.action_id).toBe("act-1");
    expect(receipt.signature).toBe("ed25519:xyz");
    expect(mockFetch.mock.calls[0][0]).toContain("/actions/act-1/notarize");
  });

  it("session supports full authorize → notarize flow", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(201, authResponse))
      .mockResolvedValueOnce(mockResponse(200, receiptResponse));

    const session = aira.session("agent-1", { modelId: "gpt-4o" });

    const auth = await session.authorize({ actionType: "test", details: "d" });
    expect(auth.status).toBe("authorized");

    const receipt = await session.notarize({
      actionId: auth.action_id,
      outcome: "completed",
    });
    expect(receipt.status).toBe("notarized");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("AiraSession constructed directly", () => {
  it("works when constructed with new", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, authResponse));
    const session = new AiraSession(aira, "agent-2");
    await session.authorize({ actionType: "test", details: "d" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-2");
  });
});
