import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira } from "../src/client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 || status === 201 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  };
}

let aira: Aira;

beforeEach(() => {
  mockFetch.mockReset();
  aira = new Aira({ apiKey: "aira_test_xxx" });
});

// ==================== require_approval ====================

describe("require_approval", () => {
  it("sends requireApproval in request body", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-1",
        status: "pending_approval",
        receipt_id: null,
        payload_hash: null,
        signature: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    await aira.notarize({
      actionType: "loan_decision",
      details: "Approve loan for $50k",
      requireApproval: true,
      approvers: ["manager@example.com"],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBe(true);
    expect(body.approvers).toEqual(["manager@example.com"]);
  });

  it("omits requireApproval when false/unset", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-1",
        receipt_id: "rct-1",
        payload_hash: "sha256:abc",
        signature: "ed25519:xyz",
        timestamp_token: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    await aira.notarize({ actionType: "test", details: "No approval" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBeUndefined();
    expect(body.approvers).toBeUndefined();
  });

  it("omits requireApproval when explicitly false", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-1",
        receipt_id: "rct-1",
        payload_hash: "sha256:abc",
        signature: "ed25519:xyz",
        timestamp_token: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    await aira.notarize({
      actionType: "test",
      details: "Explicit false",
      requireApproval: false,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // false || undefined → undefined, so it should be filtered out by buildBody
    expect(body.require_approval).toBeUndefined();
  });

  it("sends approvers as array of emails", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-1",
        status: "pending_approval",
        receipt_id: null,
        payload_hash: null,
        signature: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    await aira.notarize({
      actionType: "test",
      details: "Multi-approver",
      requireApproval: true,
      approvers: ["alice@example.com", "bob@example.com"],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.approvers).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("returns pending_approval status in response", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-pending",
        status: "pending_approval",
        receipt_id: null,
        payload_hash: null,
        signature: null,
        timestamp_token: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    const result = await aira.notarize({
      actionType: "test",
      details: "Needs approval",
      requireApproval: true,
    });

    expect(result.action_id).toBe("act-pending");
  });

  it("sends requireApproval=true with other params", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_id: "act-1",
        status: "pending_approval",
        receipt_id: null,
        payload_hash: null,
        signature: null,
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
      }),
    );

    await aira.notarize({
      actionType: "email_sent",
      details: "Sent email",
      agentId: "agent-1",
      modelId: "gpt-4o",
      requireApproval: true,
      approvers: ["boss@example.com"],
      idempotencyKey: "idem-123",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.action_type).toBe("email_sent");
    expect(body.agent_id).toBe("agent-1");
    expect(body.model_id).toBe("gpt-4o");
    expect(body.require_approval).toBe(true);
    expect(body.approvers).toEqual(["boss@example.com"]);
    expect(body.idempotency_key).toBe("idem-123");
  });
});
