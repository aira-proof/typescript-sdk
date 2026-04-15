/**
 * Tests for the post-LangChain-RFC SDK methods.
 *
 * Pins the contract for the SDK methods that wrap:
 * - Replay context (F10)
 * - Compliance bundles (PR #15)
 * - Drift detection (PR #16)
 * - Merkle settlement (PR #22)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira } from "../src";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  };
}

function paginated(data: unknown[], total = data.length) {
  return mockResponse(200, {
    data,
    pagination: { total, page: 1, per_page: 20, has_more: false },
    request_id: "r",
  });
}

let aira: Aira;

beforeEach(() => {
  mockFetch.mockReset();
  aira = new Aira({ apiKey: "aira_live_test", baseUrl: "https://api.airaproof.com" });
});

// ─── Replay context ─────────────────────────────────────────────────

describe("authorize() with replay context", () => {
  it("passes the new optional fields through to the body", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, {
        action_uuid: "a1",
        status: "authorized",
        created_at: "2026-04-11T10:00:00Z",
        request_id: "r1",
        warnings: null,
      }),
    );

    await aira.authorize({
      actionType: "tool_call",
      details: "x",
      systemPromptHash: "sha256:" + "a".repeat(64),
      toolInputsHash: "sha256:" + "b".repeat(64),
      modelParams: { temperature: 0.0, seed: 42 },
      executionEnv: { sdk_version: "2.0.1", framework: "langchain" },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system_prompt_hash).toBe("sha256:" + "a".repeat(64));
    expect(body.tool_inputs_hash).toBe("sha256:" + "b".repeat(64));
    expect(body.model_params).toEqual({ temperature: 0.0, seed: 42 });
    expect(body.execution_env.framework).toBe("langchain");
  });

  it("omits the replay context fields when not supplied", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, {
        action_uuid: "a1",
        status: "authorized",
        created_at: "x",
        request_id: "r",
        warnings: null,
      }),
    );

    await aira.authorize({ actionType: "x", details: "x" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system_prompt_hash).toBeUndefined();
    expect(body.model_params).toBeUndefined();
  });
});

describe("getReplayContext", () => {
  it("fetches the replay context bundle for an action", async () => {
    const expected = {
      action_uuid: "a1",
      system_prompt_hash: "sha256:abc",
      model_params: { temperature: 0.7 },
    };
    mockFetch.mockResolvedValueOnce(mockResponse(200, expected));

    const result = await aira.getReplayContext("a1");
    expect(result).toEqual(expected);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.airaproof.com/api/v1/actions/a1/replay-context",
    );
  });
});

// ─── Compliance bundles ─────────────────────────────────────────────

describe("compliance bundles", () => {
  it("creates a bundle", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, { id: "b1", framework: "eu_ai_act_art12", merkle_root: "abc" }),
    );

    const result = await aira.createComplianceBundle({
      framework: "eu_ai_act_art12",
      periodStart: "2026-01-01T00:00:00Z",
      periodEnd: "2026-04-01T00:00:00Z",
      title: "Q1 2026",
    });

    expect(result.id).toBe("b1");
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.framework).toBe("eu_ai_act_art12");
    expect(body.title).toBe("Q1 2026");
  });

  it("lists bundles", async () => {
    mockFetch.mockResolvedValueOnce(paginated([{ id: "b1" }, { id: "b2" }]));
    const result = await aira.listComplianceBundles();
    expect(result.total).toBe(2);
  });

  it("gets a bundle", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { id: "b1" }));
    const result = await aira.getComplianceBundle("b1");
    expect(result.id).toBe("b1");
  });

  it("exports the self-contained JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        bundle_uuid: "b1",
        merkle_root: "abc",
        receipts: [],
        signing: { jwks_url: "https://api.airaproof.com/api/v1/.well-known/jwks.json" },
      }),
    );

    const result = await aira.exportComplianceBundle("b1");
    expect(result.merkle_root).toBe("abc");
    expect((result.signing as any).jwks_url).toContain("jwks.json");
  });

  it("returns inclusion proof", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { bundle_uuid: "b1", receipt_uuid: "r1", siblings: [] }),
    );
    const result = await aira.getBundleInclusionProof("b1", "r1");
    expect(result.receipt_uuid).toBe("r1");
  });
});

// ─── Drift detection ────────────────────────────────────────────────

describe("drift detection", () => {
  it("gets drift status", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { agent_id: "bot", has_baseline: true, kl_divergence: 0.12 }),
    );
    const result = await aira.getDriftStatus("bot", 48);
    expect(result.has_baseline).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toContain("lookback_hours=48");
  });

  it("computes a production baseline", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, { id: "b1", baseline_type: "production" }),
    );
    const result = await aira.computeDriftBaseline({
      agentId: "bot",
      windowStart: "2026-01-01T00:00:00Z",
      windowEnd: "2026-01-08T00:00:00Z",
    });
    expect(result.baseline_type).toBe("production");
  });

  it("seeds a synthetic baseline", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, { id: "b1", baseline_type: "synthetic" }),
    );
    const result = await aira.seedSyntheticBaseline({
      agentId: "bot",
      expectedDistribution: { email: 0.7, api: 0.3 },
      expectedActionsPerDay: 50,
    });
    expect(result.baseline_type).toBe("synthetic");
  });

  it("runs a drift check returning null when no drift", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, null));
    const result = await aira.runDriftCheck("bot");
    expect(result).toBeNull();
  });

  it("runs a drift check that returns an alert", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { id: "a1", severity: "warning" }),
    );
    const result = await aira.runDriftCheck("bot");
    expect(result?.severity).toBe("warning");
  });

  it("lists drift alerts", async () => {
    mockFetch.mockResolvedValueOnce(paginated([{ id: "a1" }]));
    const result = await aira.listDriftAlerts("bot", 1, false);
    expect(result.total).toBe(1);
    expect(mockFetch.mock.calls[0][0]).toContain("acknowledged=false");
  });

  it("acknowledges a drift alert", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { id: "a1", acknowledged_by: "ops@x.com" }),
    );
    const result = await aira.acknowledgeDriftAlert("bot", "a1");
    expect(result.acknowledged_by).toBe("ops@x.com");
  });
});

// ─── Merkle settlement ──────────────────────────────────────────────

describe("Merkle settlement", () => {
  it("creates a settlement", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(201, { id: "s1", merkle_root: "abc", receipt_count: 100 }),
    );
    const result = await aira.createSettlement();
    expect(result?.receipt_count).toBe(100);
  });

  it("returns null when no unsettled receipts", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(201, null));
    const result = await aira.createSettlement();
    expect(result).toBeNull();
  });

  it("lists settlements", async () => {
    mockFetch.mockResolvedValueOnce(paginated([{ id: "s1" }]));
    const result = await aira.listSettlements();
    expect(result.total).toBe(1);
  });

  it("gets a settlement", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { id: "s1" }));
    const result = await aira.getSettlement("s1");
    expect(result.id).toBe("s1");
  });

  it("returns inclusion proof for a settled receipt", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        settlement_uuid: "s1",
        receipt_uuid: "r1",
        merkle_root: "abc",
        leaf_hash: "h",
        index: 5,
        leaf_count: 100,
        siblings: ["a", "b", "c"],
      }),
    );
    const result = await aira.getSettlementInclusionProof("r1");
    expect(result.leaf_count).toBe(100);
    expect((result.siblings as string[]).length).toBe(3);
  });
});
