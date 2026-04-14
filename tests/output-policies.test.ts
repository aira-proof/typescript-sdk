import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira } from "../src";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  };
}

const POLICY_OK = {
  enabled: true,
  mode: "flag",
  libraries: ["pii", "credentials", "prompt_injection"],
  deny_severity_threshold: "critical",
  redact_severity_threshold: "warning",
  request_id: "req-1",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("getOutputPolicy", () => {
  it("GETs /output-policies and returns the typed blob", async () => {
    const aira = new Aira({
      apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      baseUrl: "http://test",
    });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, POLICY_OK));

    const policy = await aira.getOutputPolicy();
    expect(policy.mode).toBe("flag");
    expect(policy.enabled).toBe(true);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/output-policies");
    expect((init as RequestInit).method).toBe("GET");
  });
});

describe("updateOutputPolicy", () => {
  it("PATCHes only the supplied fields", async () => {
    const aira = new Aira({
      apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      baseUrl: "http://test",
    });
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, { ...POLICY_OK, mode: "deny" }),
    );

    const policy = await aira.updateOutputPolicy({ mode: "deny" });
    expect(policy.mode).toBe("deny");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/output-policies");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    // Only the field the caller supplied.
    expect(body).toEqual({ mode: "deny" });
  });

  it("strips undefined fields so they don't travel as null", async () => {
    const aira = new Aira({
      apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      baseUrl: "http://test",
    });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, POLICY_OK));

    await aira.updateOutputPolicy({
      enabled: false,
      mode: undefined,
      libraries: ["pii"],
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({ enabled: false, libraries: ["pii"] });
    expect("mode" in body).toBe(false);
  });
});

describe("ActionReceipt output_scan_flags", () => {
  it("carries the scan flags through notarize responses", async () => {
    const aira = new Aira({
      apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      baseUrl: "http://test",
    });
    const flags = {
      scanned_at: "2026-04-15T00:00:00Z",
      libraries: ["credentials"],
      mode: "flag",
      decision: "deny",
      worst_severity: "critical",
      hits: [
        {
          name: "aws_access_key",
          library: "credentials",
          severity: "critical",
          description: "AWS access key ID",
          matches: 1,
          sample: "[REDACTED]",
        },
      ],
    };
    mockFetch
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          action_id: "act-1",
          status: "authorized",
          created_at: "2026-04-15T00:00:00Z",
          request_id: "req-auth",
          warnings: [],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          action_id: "act-1",
          status: "notarized",
          created_at: "2026-04-15T00:00:00Z",
          request_id: "req-not",
          receipt_id: "rec-1",
          payload_hash: "sha256:abc",
          signature: "ed25519:sig",
          timestamp_token: "tsa",
          output_scan_flags: flags,
          warnings: [],
        }),
      );

    await aira.authorize({
      actionType: "tool_call",
      details: "call",
      agentId: "a1",
    });
    const receipt = await aira.notarize({
      actionId: "act-1",
      outcome: "completed",
      outcomeDetails: "leaked key: AKIAIOSFODNN7EXAMPLE",
    });
    expect(receipt.output_scan_flags).toBeDefined();
    expect(receipt.output_scan_flags?.mode).toBe("flag");
    expect(receipt.output_scan_flags?.hits[0].sample).toBe("[REDACTED]");
  });
});
