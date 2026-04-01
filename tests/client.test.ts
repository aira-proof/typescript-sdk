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
    mockFetch.mockResolvedValue(mockResponse(400, { code: "VALIDATION", error: "Bad request" }));
    await expect(aira.getAction("x")).rejects.toThrow(AiraError);
    await expect(aira.getAction("x")).rejects.toThrow("[VALIDATION] Bad request");
  });

  it("throws AiraError on 401", async () => {
    mockFetch.mockResolvedValue(mockResponse(401, { code: "UNAUTHORIZED", error: "Invalid token" }));
    try {
      await aira.getAction("x");
    } catch (e) {
      expect(e).toBeInstanceOf(AiraError);
      expect((e as AiraError).status).toBe(401);
      expect((e as AiraError).code).toBe("UNAUTHORIZED");
    }
  });

  it("throws AiraError on 500", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, { code: "INTERNAL", error: "Server error" }));
    await expect(aira.getAction("x")).rejects.toThrow(AiraError);
  });
});

// ==================== Actions ====================

describe("actions", () => {
  it("notarize", async () => {
    const receipt = { action_id: "act-1", payload_hash: "sha256:abc", signature: "ed25519:xyz", receipt_id: "rct-1", action_type: "email_sent", agent_id: "agent-1", created_at: "2026-01-01" };
    mockFetch.mockResolvedValue(mockResponse(201, receipt));

    const result = await aira.notarize({ actionType: "email_sent", details: "Sent email", agentId: "agent-1" });
    expect(result.action_id).toBe("act-1");
    expect(result.signature).toBe("ed25519:xyz");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/actions");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.action_type).toBe("email_sent");
    expect(body.agent_id).toBe("agent-1");
  });

  it("notarize truncates long details", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { action_id: "a", payload_hash: "h", signature: "s", receipt_id: "r", action_type: "t", agent_id: null, created_at: "d" }));
    const longDetails = "x".repeat(60_000);
    await aira.notarize({ actionType: "test", details: longDetails });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.details.length).toBeLessThan(60_000);
    expect(body.details).toContain("[truncated]");
  });

  it("notarize with idempotency key", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { action_id: "a", payload_hash: "h", signature: "s", receipt_id: "r", action_type: "t", agent_id: null, created_at: "d" }));
    await aira.notarize({ actionType: "test", details: "d", idempotencyKey: "key-1" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.idempotency_key).toBe("key-1");
  });

  it("getAction", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { action_id: "act-1", action_type: "test", status: "active" }));
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

  it("authorizeAction", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true }));
    await aira.authorizeAction("act-1");
    expect(mockFetch.mock.calls[0][0]).toContain("/actions/act-1/authorize");
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
    mockFetch.mockResolvedValue(mockResponse(200, { chain: [{ action_id: "a1" }, { action_id: "a2" }] }));
    const chain = await aira.getActionChain("act-1");
    expect(chain.length).toBe(2);
  });

  it("verifyAction (no auth)", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { valid: true, message: "OK", receipt_id: "r1", verified_at: "d", public_key_id: "k1" }));
    const result = await aira.verifyAction("act-1");
    expect(result.valid).toBe(true);
    // Should not send auth header
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ==================== Agents ====================

describe("agents", () => {
  it("registerAgent", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { id: "1", agent_slug: "my-agent", display_name: "My Agent", status: "active" }));
    const agent = await aira.registerAgent({ agentSlug: "my-agent", displayName: "My Agent", capabilities: ["email"] });
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
    mockFetch.mockResolvedValue(mockResponse(201, { id: "v1", version: "1.0.0", status: "active" }));
    const v = await aira.publishVersion("test", { version: "1.0.0", modelId: "claude" });
    expect(v.version).toBe("1.0.0");
  });

  it("listVersions", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, [{ id: "v1", version: "1.0.0" }]));
    const versions = await aira.listVersions("test");
    expect(versions.length).toBe(1);
  });

  it("decommissionAgent", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { agent_slug: "test", status: "decommissioned" }));
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
    mockFetch.mockResolvedValue(mockResponse(201, { id: "pkg-1", title: "Audit", package_hash: "sha256:x", signature: "ed25519:y" }));
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
    mockFetch.mockResolvedValue(mockResponse(201, { id: "s1", framework: "eu-ai-act", status: "compliant" }));
    const snap = await aira.createComplianceSnapshot({ framework: "eu-ai-act", findings: { art_12: "pass" } });
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
    mockFetch.mockResolvedValue(mockResponse(201, { id: "esc-1", status: "active", balance: "0" }));
    const account = await aira.createEscrowAccount({ purpose: "Liability" });
    expect(account.id).toBe("esc-1");
  });

  it("escrowDeposit", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { id: "tx-1", transaction_type: "deposit", amount: "5000.00" }));
    const tx = await aira.escrowDeposit("esc-1", 5000, "Liability commitment");
    expect(tx.amount).toBe("5000.00");
  });

  it("escrowRelease", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { id: "tx-2", transaction_type: "release", amount: "5000.00" }));
    const tx = await aira.escrowRelease("esc-1", 5000);
    expect(tx.transaction_type).toBe("release");
  });

  it("escrowDispute", async () => {
    mockFetch.mockResolvedValue(mockResponse(201, { id: "tx-3", transaction_type: "dispute", amount: "2000.00" }));
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
    mockFetch.mockResolvedValue(mockResponse(200, { content: "You have 5 actions", tools_used: ["query_actions"] }));
    const result = await aira.ask("How many actions?");
    expect(result.content).toBe("You have 5 actions");
    expect(result.tools_used).toContain("query_actions");
  });

  it("ask with model", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { content: "answer", tools_used: [], model_id: "gpt-4o" }));
    await aira.ask("question", { model: "gpt-4o" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o");
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
    mockFetch.mockResolvedValue(mockResponse(200, { valid: true, message: "OK", receipt_id: null, verified_at: "d", public_key_id: "k" }));
    await aira.verifyAction("act-1");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ==================== DID ====================

describe("DID", () => {
  it("getAgentDid", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { did: "did:web:airaproof.com:agents:my-agent", version: 1 }));
    const result = await aira.getAgentDid("my-agent");
    expect(result.did).toBe("did:web:airaproof.com:agents:my-agent");
    expect(mockFetch.mock.calls[0][0]).toContain("/agents/my-agent/did");
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("rotateAgentKeys", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { did: "did:web:airaproof.com:agents:my-agent", version: 2 }));
    const result = await aira.rotateAgentKeys("my-agent");
    expect(result.version).toBe(2);
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("resolveDid", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { id: "did:web:example.com:agents:other" }));
    const result = await aira.resolveDid("did:web:example.com:agents:other");
    expect(result.id).toBe("did:web:example.com:agents:other");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.did).toBe("did:web:example.com:agents:other");
  });
});

// ==================== Verifiable Credentials ====================

describe("verifiable credentials", () => {
  it("getAgentCredential", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { type: ["VerifiableCredential"], issuer: "did:web:airaproof.com" }));
    const result = await aira.getAgentCredential("my-agent");
    expect(result.issuer).toBe("did:web:airaproof.com");
    expect(mockFetch.mock.calls[0][0]).toContain("/agents/my-agent/credential");
  });

  it("getAgentCredentials", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { credentials: [{ id: "vc-1" }, { id: "vc-2" }] }));
    const result = await aira.getAgentCredentials("my-agent");
    expect((result.credentials as unknown[]).length).toBe(2);
  });

  it("revokeCredential", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { revoked: true }));
    const result = await aira.revokeCredential("my-agent", "Compromised");
    expect(result.revoked).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reason).toBe("Compromised");
  });

  it("revokeCredential with default reason", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { revoked: true }));
    await aira.revokeCredential("my-agent");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reason).toBe("");
  });

  it("verifyCredential", async () => {
    const vc = { type: ["VerifiableCredential"], proof: { type: "Ed25519Signature2020" } };
    mockFetch.mockResolvedValue(mockResponse(200, { valid: true, checks: {} }));
    const result = await aira.verifyCredential(vc);
    expect(result.valid).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.credential).toEqual(vc);
  });
});

// ==================== Mutual Notarization ====================

describe("mutual notarization", () => {
  it("requestMutualSign", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "pending", action_id: "act-1" }));
    const result = await aira.requestMutualSign("act-1", "did:web:example.com:agents:other");
    expect(result.status).toBe("pending");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.counterparty_did).toBe("did:web:example.com:agents:other");
  });

  it("getPendingMutualSign", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { payload: { action_id: "act-1" }, payload_hash: "sha256:abc" }));
    const result = await aira.getPendingMutualSign("act-1");
    expect(result.payload_hash).toBe("sha256:abc");
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("completeMutualSign", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "completed", combined_receipt_hash: "sha256:xyz" }));
    const result = await aira.completeMutualSign("act-1", "did:web:example.com:agents:other", "zsig123", "sha256:abc");
    expect(result.status).toBe("completed");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.did).toBe("did:web:example.com:agents:other");
    expect(body.signature).toBe("zsig123");
    expect(body.signed_payload_hash).toBe("sha256:abc");
  });

  it("getMutualSignReceipt", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { receipt_id: "rct-1", signatures: ["sig-a", "sig-b"] }));
    const result = await aira.getMutualSignReceipt("act-1");
    expect((result.signatures as unknown[]).length).toBe(2);
  });

  it("rejectMutualSign", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "rejected" }));
    const result = await aira.rejectMutualSign("act-1", "Not authorized");
    expect(result.status).toBe("rejected");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reason).toBe("Not authorized");
  });

  it("rejectMutualSign with default reason", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { status: "rejected" }));
    await aira.rejectMutualSign("act-1");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reason).toBe("");
  });
});

// ==================== Reputation ====================

describe("reputation", () => {
  it("getReputation", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { score: 84, tier: "Verified" }));
    const result = await aira.getReputation("my-agent");
    expect(result.score).toBe(84);
    expect(result.tier).toBe("Verified");
  });

  it("getReputationHistory", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { history: [{ score: 80 }, { score: 84 }] }));
    const result = await aira.getReputationHistory("my-agent");
    expect((result.history as unknown[]).length).toBe(2);
  });

  it("attestReputation", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { recorded: true }));
    const result = await aira.attestReputation("my-agent", "did:web:example.com:agents:other", "act-1", "positive", "zsig456");
    expect(result.recorded).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.counterparty_did).toBe("did:web:example.com:agents:other");
    expect(body.action_id).toBe("act-1");
    expect(body.attestation).toBe("positive");
    expect(body.signature).toBe("zsig456");
  });

  it("verifyReputation", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { score_hash: "sha256:rep", inputs: {} }));
    const result = await aira.verifyReputation("my-agent");
    expect(result.score_hash).toBe("sha256:rep");
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });
});
