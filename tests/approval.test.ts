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

// ==================== require_approval branch ====================

describe("authorize() with requireApproval", () => {
  it("sends requireApproval in request body", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_uuid: "act-1",
        status: "pending_approval",
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
        warnings: null,
      }),
    );

    await aira.authorize({
      actionType: "loan_decision",
      details: "Approve loan for $50k",
      requireApproval: true,
      approvers: ["manager@example.com"],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBe(true);
    expect(body.approvers).toEqual(["manager@example.com"]);
  });

  it("returns pending_approval status", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_uuid: "act-pending",
        status: "pending_approval",
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
        warnings: null,
      }),
    );

    const auth = await aira.authorize({
      actionType: "test",
      details: "Needs approval",
      requireApproval: true,
    });

    expect(auth.status).toBe("pending_approval");
    expect(auth.action_uuid).toBe("act-pending");
  });

  it("omits requireApproval when false/unset", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_uuid: "act-1",
        status: "authorized",
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
        warnings: null,
      }),
    );

    await aira.authorize({ actionType: "test", details: "No approval" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBeUndefined();
    expect(body.approvers).toBeUndefined();
  });

  it("sends multiple approvers", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_uuid: "act-1",
        status: "pending_approval",
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
        warnings: null,
      }),
    );

    await aira.authorize({
      actionType: "test",
      details: "Multi-approver",
      requireApproval: true,
      approvers: ["alice@example.com", "bob@example.com"],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.approvers).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("combines requireApproval with other metadata", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        action_uuid: "act-1",
        status: "pending_approval",
        created_at: "2026-04-01T00:00:00Z",
        request_id: "req-1",
        warnings: null,
      }),
    );

    await aira.authorize({
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
