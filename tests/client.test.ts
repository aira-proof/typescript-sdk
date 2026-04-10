import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira, AiraError } from "../src";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  };
}

function paginatedResponse(data: unknown[], total = 1) {
  return mockResponse(200, { data, pagination: { total, page: 1, per_page: 20, has_more: false } });
}

function authorizationResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return mockResponse(201, {
    action_id: "act-1",
    status: "authorized",
    created_at: "2026-04-07T00:00:00Z",
    request_id: "req-1",
    warnings: null,
    ...overrides,
  });
}

function receiptResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return mockResponse(200, {
    action_id: "act-1",
    status: "notarized",
    created_at: "2026-04-07T00:00:01Z",
    request_id: "req-2",
    receipt_id: "rct-1",
    payload_hash: "sha256:abc",
    signature: "ed25519:xyz",
    timestamp_token: null,
    warnings: null,
    ...overrides,
  });
}

let aira: Aira;

beforeEach(() => {
  mockFetch.mockReset();
  aira = new Aira({ apiKey: "aira_test_xxx" });
});

// ==================== Construction ====================

describe("Aira constructor", () => {
  it("throws on empty apiKey", () => {
    expect(() => new Aira({ apiKey: "" })).toThrow("apiKey is required");
  });

  it("warns on non-standard key prefix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Aira({ apiKey: "bad-key" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aira_live_"));
    warn.mockRestore();
  });

  it("accepts valid key without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Aira({ apiKey: "aira_live_test123" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ==================== Error handling ====================

describe("error handling", () => {
  it("throws AiraError on 400", async () => {
    mockFetch.mockResolvedValue(mockResponse(400, { code: "VALIDATION", message: "Bad request" }));
    await expect(aira.getAction("x")).rejects.toThrow(AiraError);
    await expect(aira.getAction("x")).rejects.toThrow("[VALIDATION] Bad request");
  });

  it("throws AiraError on 401", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { code: "UNAUTHORIZED", message: "Invalid token" }));
    try {
      await aira.getAction("x");
    } catch (e) {
      expect(e).toBeInstanceOf(AiraError);
      expect((e as AiraError).statusCode).toBe(401);
      expect((e as AiraError).code).toBe("UNAUTHORIZED");
    }
  });

  it("exposes details from backend error response", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, {
        code: "POLICY_DENIED",
        message: "Blocked",
        details: { action_id: "act-1", policy_id: "pol-1" },
        request_id: "req-1",
      }),
    );
    try {
      await aira.getAction("x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AiraError);
      expect((e as AiraError).code).toBe("POLICY_DENIED");
      expect((e as AiraError).details).toEqual({
        action_id: "act-1",
        policy_id: "pol-1",
      });
    }
  });

  it("throws AiraError on 500", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, { code: "INTERNAL", message: "Server error" }));
    await expect(aira.getAction("x")).rejects.toThrow(AiraError);
  });
});

// ==================== authorize() — Step 1 ====================

describe("authorize (Step 1)", () => {
  it("returns authorized status for allowed actions", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());

    const auth = await aira.authorize({
      actionType: "email_sent",
      details: "Sent email",
      agentId: "agent-1",
    });

    expect(auth.status).toBe("authorized");
    expect(auth.action_id).toBe("act-1");
    expect(auth.created_at).toBeDefined();
    expect(auth.request_id).toBeDefined();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/actions");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.action_type).toBe("email_sent");
    expect(body.agent_id).toBe("agent-1");
    expect(body.details).toBe("Sent email");
  });

  it("returns pending_approval when require_approval is set", async () => {
    mockFetch.mockResolvedValue(
      authorizationResponse({ status: "pending_approval", action_id: "act-pending" }),
    );

    const auth = await aira.authorize({
      actionType: "loan_decision",
      details: "Approve €50k",
      requireApproval: true,
      approvers: ["manager@example.com"],
    });

    expect(auth.status).toBe("pending_approval");
    expect(auth.action_id).toBe("act-pending");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBe(true);
    expect(body.approvers).toEqual(["manager@example.com"]);
  });

  it("throws POLICY_DENIED as AiraError", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(403, { code: "POLICY_DENIED", message: "Blocked by policy 'Wire transfers'" }),
    );

    try {
      await aira.authorize({ actionType: "wire_transfer", details: "Send $1M" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AiraError);
      expect((e as AiraError).statusCode).toBe(403);
      expect((e as AiraError).code).toBe("POLICY_DENIED");
    }
  });

  it("throws DUPLICATE_REQUEST on 409", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(409, { code: "DUPLICATE_REQUEST", message: "Idempotency key already used" }),
    );

    await expect(
      aira.authorize({ actionType: "test", details: "d", idempotencyKey: "dup-1" }),
    ).rejects.toThrow(AiraError);
  });

  it("truncates long details", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());
    const longDetails = "x".repeat(60_000);
    await aira.authorize({ actionType: "test", details: longDetails });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.details.length).toBeLessThan(60_000);
    expect(body.details).toContain("[truncated]");
  });

  it("sends idempotency key", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());
    await aira.authorize({ actionType: "test", details: "d", idempotencyKey: "key-1" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.idempotency_key).toBe("key-1");
  });

  it("sends endpoint_url", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());
    await aira.authorize({
      actionType: "api_call",
      details: "Charged customer",
      endpointUrl: "https://api.stripe.com/v1/charges",
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.endpoint_url).toBe("https://api.stripe.com/v1/charges");
  });

  it("omits require_approval when false", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());
    await aira.authorize({ actionType: "test", details: "d", requireApproval: false });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.require_approval).toBeUndefined();
  });

  it("sends all metadata fields", async () => {
    mockFetch.mockResolvedValue(authorizationResponse());
    await aira.authorize({
      actionType: "email_sent",
      details: "Sent email",
      agentId: "agent-1",
      agentVersion: "1.2.0",
      modelId: "gpt-5",
      modelVersion: "2026-03",
      instructionHash: "sha256:abc",
      parentActionId: "parent-1",
      storeDetails: true,
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent-1");
    expect(body.agent_version).toBe("1.2.0");
    expect(body.model_id).toBe("gpt-5");
    expect(body.model_version).toBe("2026-03");
    expect(body.instruction_hash).toBe("sha256:abc");
    expect(body.parent_action_id).toBe("parent-1");
    expect(body.store_details).toBe(true);
  });
});

// ==================== notarize() — Step 2 ====================

describe("notarize (Step 2)", () => {
  it("notarizes completed outcome and returns receipt", async () => {
    mockFetch.mockResolvedValue(receiptResponse());

    const receipt = await aira.notarize({ actionId: "act-1", outcome: "completed" });

    expect(receipt.status).toBe("notarized");
    expect(receipt.action_id).toBe("act-1");
    expect(receipt.signature).toBe("ed25519:xyz");
    expect(receipt.payload_hash).toBe("sha256:abc");
    expect(receipt.receipt_id).toBe("rct-1");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/actions/act-1/notarize");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.outcome).toBe("completed");
  });

  it("defaults outcome to completed", async () => {
    mockFetch.mockResolvedValue(receiptResponse());
    await aira.notarize({ actionId: "act-1" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.outcome).toBe("completed");
  });

  it("notarizes failed outcome with details", async () => {
    mockFetch.mockResolvedValue(
      receiptResponse({
        status: "failed",
        receipt_id: null,
        payload_hash: null,
        signature: null,
      }),
    );

    const receipt = await aira.notarize({
      actionId: "act-1",
      outcome: "failed",
      outcomeDetails: "Wire rejected by bank",
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.receipt_id).toBeNull();
    expect(receipt.signature).toBeNull();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.outcome).toBe("failed");
    expect(body.outcome_details).toBe("Wire rejected by bank");
  });

  it("throws on invalid state transition (e.g. double-notarize)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(409, { code: "INVALID_STATE", message: "Action already notarized" }),
    );

    await expect(
      aira.notarize({ actionId: "act-1", outcome: "completed" }),
    ).rejects.toThrow(AiraError);
  });

  it("throws when notarizing unauthorized action", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(404, { code: "NOT_FOUND", message: "Action not found" }),
    );

    await expect(aira.notarize({ actionId: "missing" })).rejects.toThrow(AiraError);
  });
});

// ==================== Full two-step flow ====================

describe("full authorize → notarize flow", () => {
  it("authorizes, executes, then notarizes completed", async () => {
    mockFetch
      .mockResolvedValueOnce(authorizationResponse({ action_id: "act-42" }))
      .mockResolvedValueOnce(receiptResponse({ action_id: "act-42" }));

    const auth = await aira.authorize({
      actionType: "wire_transfer",
      details: "Send €75K",
      agentId: "payments-agent",
    });
    expect(auth.status).toBe("authorized");

    // ... agent executes the action here ...

    const receipt = await aira.notarize({
      actionId: auth.action_id,
      outcome: "completed",
      outcomeDetails: "Wire ref=TXN123",
    });

    expect(receipt.status).toBe("notarized");
    expect(receipt.action_id).toBe("act-42");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify the two URLs
    expect(mockFetch.mock.calls[0][0]).toContain("/actions");
    expect(mockFetch.mock.calls[1][0]).toContain("/actions/act-42/notarize");
  });

  it("authorizes pending_approval, does NOT notarize (caller enqueues)", async () => {
    mockFetch.mockResolvedValueOnce(
      authorizationResponse({ status: "pending_approval", action_id: "act-wait" }),
    );

    const auth = await aira.authorize({
      actionType: "wire_transfer",
      details: "Send €75K",
      requireApproval: true,
    });

    expect(auth.status).toBe("pending_approval");
    expect(mockFetch).toHaveBeenCalledTimes(1); // only authorize, no notarize
  });

  it("authorizes, action fails, notarizes as failed", async () => {
    mockFetch
      .mockResolvedValueOnce(authorizationResponse({ action_id: "act-fail" }))
      .mockResolvedValueOnce(
        receiptResponse({
          action_id: "act-fail",
          status: "failed",
          receipt_id: null,
          payload_hash: null,
          signature: null,
        }),
      );

    const auth = await aira.authorize({ actionType: "api_call", details: "Call partner" });
    const receipt = await aira.notarize({
      actionId: auth.action_id,
      outcome: "failed",
      outcomeDetails: "Partner API returned 503",
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.signature).toBeNull();
  });
});

// ==================== cosign ====================

describe("cosign", () => {
  it("POSTs to /actions/:id/cosign", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        cosignature_id: "cos-1",
        action_id: "act-1",
        cosigner_email: "manager@example.com",
        cosigned_at: "2026-04-07T00:00:00Z",
        request_id: "req-1",
      }),
    );
    const result = await aira.cosign({ actionId: "act-1" });
    expect(result.cosignature_id).toBe("cos-1");
    expect(result.cosigner_email).toBe("manager@example.com");
    expect(mockFetch.mock.calls[0][0]).toContain("/actions/act-1/cosign");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });
});

// ==================== Actions (other) ====================

describe("actions", () => {
  it("getAction", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { action_id: "act-1", action_type: "test", status: "active" }),
    );
    const result = await aira.getAction("act-1");
    expect(result.action_id).toBe("act-1");
  });

  it("listActions with filters", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([{ action_id: "a1" }], 5));
    const result = await aira.listActions({ page: 1, actionType: "email_sent" });
    expect(result.total).toBe(5);
    expect(result.data.length).toBe(1);
    expect(mockFetch.mock.calls[0][0]).toContain("action_type=email_sent");
  });

  it("setLegalHold", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));
    await aira.setLegalHold("act-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("releaseLegalHold", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));
    await aira.releaseLegalHold("act-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("getActionChain", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { chain: [{ action_id: "a1" }, { action_id: "a2" }] }),
    );
    const chain = await aira.getActionChain("act-1");
    expect(chain.length).toBe(2);
  });

  it("verifyAction (no auth)", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        valid: true,
        message: "OK",
        receipt_id: "r1",
        verified_at: "d",
        public_key_id: "k1",
      }),
    );
    const result = await aira.verifyAction("act-1");
    expect(result.valid).toBe(true);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ==================== Agents ====================

describe("agents", () => {
  it("registerAgent", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        id: "1",
        agent_slug: "my-agent",
        display_name: "My Agent",
        status: "active",
      }),
    );
    const agent = await aira.registerAgent({
      agentSlug: "my-agent",
      displayName: "My Agent",
      capabilities: ["email"],
    });
    expect(agent.agent_slug).toBe("my-agent");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_slug).toBe("my-agent");
    expect(body.capabilities).toEqual(["email"]);
  });

  it("getAgent", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { agent_slug: "test", status: "active" }));
    const agent = await aira.getAgent("test");
    expect(agent.status).toBe("active");
  });

  it("listAgents", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([{ agent_slug: "a" }], 3));
    const result = await aira.listAgents({ page: 1 });
    expect(result.total).toBe(3);
  });

  it("updateAgent", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { agent_slug: "test", description: "Updated" }));
    await aira.updateAgent("test", { description: "Updated" });
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  it("publishVersion", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "v1", version: "1.0.0", status: "active" }),
    );
    const v = await aira.publishVersion("test", { version: "1.0.0", modelId: "claude" });
    expect(v.version).toBe("1.0.0");
  });

  it("listVersions", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, [{ id: "v1", version: "1.0.0" }]));
    const versions = await aira.listVersions("test");
    expect(versions.length).toBe(1);
  });

  it("decommissionAgent", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { agent_slug: "test", status: "decommissioned" }),
    );
    const agent = await aira.decommissionAgent("test");
    expect(agent.status).toBe("decommissioned");
  });

  it("transferAgent", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await aira.transferAgent("test", "org-2", "M&A");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.to_org_id).toBe("org-2");
  });
});

// ==================== Cases ====================

describe("cases", () => {
  it("runCase", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { consensus: { decision: "APPROVE" } }));
    const result = await aira.runCase("Should we approve?", ["gpt-4o", "claude"]);
    expect(result.consensus).toBeDefined();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.models).toEqual(["gpt-4o", "claude"]);
  });

  it("listCases", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([], 0));
    const result = await aira.listCases();
    expect(result.total).toBe(0);
  });
});

// ==================== Evidence ====================

describe("evidence", () => {
  it("createEvidencePackage", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, {
        id: "pkg-1",
        title: "Audit",
        package_hash: "sha256:x",
        signature: "ed25519:y",
      }),
    );
    const pkg = await aira.createEvidencePackage({ title: "Audit", actionIds: ["a1", "a2"] });
    expect(pkg.package_hash).toBe("sha256:x");
  });

  it("listEvidencePackages", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([{ id: "p1" }], 1));
    const result = await aira.listEvidencePackages();
    expect(result.data.length).toBe(1);
  });

  it("timeTravel", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { actions: [] }));
    await aira.timeTravel({ pointInTime: "2030-01-01T00:00:00Z" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.point_in_time).toBe("2030-01-01T00:00:00Z");
  });
});

// ==================== Estate ====================

describe("estate", () => {
  it("setAgentWill", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await aira.setAgentWill("agent-1", { successorSlug: "agent-2", dataRetentionDays: 2555 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.successor_slug).toBe("agent-2");
    expect(body.data_retention_days).toBe(2555);
  });

  it("createComplianceSnapshot", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "s1", framework: "eu-ai-act", status: "compliant" }),
    );
    const snap = await aira.createComplianceSnapshot({
      framework: "eu-ai-act",
      findings: { art_12: "pass" },
    });
    expect(snap.framework).toBe("eu-ai-act");
  });

  it("listComplianceSnapshots", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([{ id: "s1" }], 1));
    const result = await aira.listComplianceSnapshots({ framework: "eu-ai-act" });
    expect(result.total).toBe(1);
  });
});

// ==================== Escrow ====================

describe("escrow", () => {
  it("createEscrowAccount", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "esc-1", status: "active", balance: "0" }),
    );
    const account = await aira.createEscrowAccount({ purpose: "Liability" });
    expect(account.id).toBe("esc-1");
  });

  it("escrowDeposit", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "tx-1", transaction_type: "deposit", amount: "5000.00" }),
    );
    const tx = await aira.escrowDeposit("esc-1", 5000, "Liability commitment");
    expect(tx.amount).toBe("5000.00");
  });

  it("escrowRelease", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "tx-2", transaction_type: "release", amount: "5000.00" }),
    );
    const tx = await aira.escrowRelease("esc-1", 5000);
    expect(tx.transaction_type).toBe("release");
  });

  it("escrowDispute", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(201, { id: "tx-3", transaction_type: "dispute", amount: "2000.00" }),
    );
    const tx = await aira.escrowDispute("esc-1", 2000, "Agent error");
    expect(tx.transaction_type).toBe("dispute");
  });

  it("listEscrowAccounts", async () => {
    mockFetch.mockResolvedValue(paginatedResponse([{ id: "e1" }], 1));
    const result = await aira.listEscrowAccounts();
    expect(result.total).toBe(1);
  });
});

// ==================== Chat ====================

describe("chat", () => {
  it("ask", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { content: "You have 5 actions", tools_used: ["query_actions"] }),
    );
    const result = await aira.ask("How many actions?");
    expect(result.content).toBe("You have 5 actions");
    expect(result.tools_used).toContain("query_actions");
  });

  it("ask with model", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { content: "answer", tools_used: [], model_id: "gpt-4o" }),
    );
    await aira.ask("question", { model: "gpt-4o" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("gpt-4o");
  });
});

// ==================== Auth header ====================

describe("auth headers", () => {
  it("sends Bearer token on authenticated requests", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));
    await aira.getAction("act-1");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer aira_test_xxx");
  });

  it("does not send auth on public endpoints", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        valid: true,
        message: "OK",
        receipt_id: null,
        verified_at: "d",
        public_key_id: "k",
      }),
    );
    await aira.verifyAction("act-1");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ==================== DID ====================

describe("DID", () => {
  it("getAgentDid", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { did: "did:web:airaproof.com:agents:my-agent", version: 1 }),
    );
    const result = await aira.getAgentDid("my-agent");
    expect(result.did).toBe("did:web:airaproof.com:agents:my-agent");
    expect(mockFetch.mock.calls[0][0]).toContain("/agents/my-agent/did");
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("rotateAgentKeys", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { did: "did:web:airaproof.com:agents:my-agent", version: 2 }),
    );
    const result = await aira.rotateAgentKeys("my-agent");
    expect(result.version).toBe(2);
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("resolveDid", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { id: "did:web:example.com:agents:other" }),
    );
    const result = await aira.resolveDid("did:web:example.com:agents:other");
    expect(result.id).toBe("did:web:example.com:agents:other");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.did).toBe("did:web:example.com:agents:other");
  });
});

// ==================== Verifiable Credentials ====================

describe("verifiable credentials", () => {
  it("getAgentCredential", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, {
        type: ["VerifiableCredential"],
        issuer: "did:web:airaproof.com",
      }),
    );
    const result = await aira.getAgentCredential("my-agent");
    expect(result.issuer).toBe("did:web:airaproof.com");
    expect(mockFetch.mock.calls[0][0]).toContain("/agents/my-agent/credential");
  });

  it("verifyCredential", async () => {
    const vc = { type: ["VerifiableCredential"], proof: { type: "Ed25519Signature2020" } };
    mockFetch.mockResolvedValue(mockResponse(200, { valid: true, checks: {} }));
    const result = await aira.verifyCredential(vc);
    expect(result.valid).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.credential).toEqual(vc);
  });

  it("revokeCredential", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { revoked: true }));
    const result = await aira.revokeCredential("my-agent", "Compromised");
    expect(result.revoked).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reason).toBe("Compromised");
  });
});

// ==================== Mutual Notarization ====================

describe("mutual notarization", () => {
  it("requestMutualSign", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "pending", action_id: "act-1" }),
    );
    const result = await aira.requestMutualSign("act-1", "did:web:example.com:agents:other");
    expect(result.status).toBe("pending");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.counterparty_did).toBe("did:web:example.com:agents:other");
  });

  it("completeMutualSign", async () => {
    mockFetch.mockResolvedValue(
      mockResponse(200, { status: "completed", combined_receipt_hash: "sha256:xyz" }),
    );
    const result = await aira.completeMutualSign(
      "act-1",
      "did:web:example.com:agents:other",
      "zsig123",
      "sha256:abc",
    );
    expect(result.status).toBe("completed");
  });
});

// ==================== Reputation ====================

describe("reputation", () => {
  it("getReputation", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { score: 84, tier: "Verified" }));
    const result = await aira.getReputation("my-agent");
    expect(result.score).toBe(84);
  });
});
