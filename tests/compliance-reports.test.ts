import { describe, it, expect, vi, beforeEach } from "vitest";
import { Aira, AiraError } from "../src";

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

function mockBinaryResponse(bytes: Uint8Array, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  };
}

const REPORT_OK = {
  id: "rep-1",
  framework: "eu_ai_act_art12",
  status: "ready",
  org_id: "org-1",
  period_start: "2026-04-01T00:00:00",
  period_end: "2026-04-30T00:00:00",
  receipt_count: 2,
  pdf_size_bytes: 1234,
  content_hash: "sha256:abc",
  signature: "ed25519:sig",
  signing_key_id: "k1",
  timestamp_token: "ts",
  timestamp_token_present: true,
  report_metadata: { article: "12", total_actions: 2 },
  generated_at: "2026-04-30T01:00:00Z",
  created_at: "2026-04-30T00:59:00Z",
  request_id: "req-1",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createComplianceReport", () => {
  it("posts to /compliance/reports and returns the report", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(201, REPORT_OK));

    const report = await aira.createComplianceReport({
      framework: "eu_ai_act_art12",
      periodStart: "2026-04-01T00:00:00",
      periodEnd: "2026-04-30T00:00:00",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/compliance/reports");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.framework).toBe("eu_ai_act_art12");
    expect(body.period_start).toBe("2026-04-01T00:00:00");
    expect(report.framework).toBe("eu_ai_act_art12");
    expect(report.receipt_count).toBe(2);
  });

  it("filters undefined params from body", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(201, REPORT_OK));

    await aira.createComplianceReport({
      framework: "eu_ai_act_art6",
      actionId: "act-1",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toEqual({ framework: "eu_ai_act_art6", action_id: "act-1" });
    expect(body.period_start).toBeUndefined();
  });
});

describe("getComplianceReport", () => {
  it("calls GET /compliance/reports/{id}", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, REPORT_OK));

    const report = await aira.getComplianceReport("rep-1");
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("http://test/api/v1/compliance/reports/rep-1");
    expect(report.id).toBe("rep-1");
  });
});

describe("listComplianceReports", () => {
  it("returns a paginated list", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        items: [REPORT_OK],
        total: 1,
        limit: 50,
        offset: 0,
        request_id: "req-2",
      }),
    );
    const result = await aira.listComplianceReports({
      framework: "eu_ai_act_art12",
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("/compliance/reports?");
    expect(url).toContain("framework=eu_ai_act_art12");
  });
});

describe("downloadComplianceReport", () => {
  it("returns Uint8Array of PDF bytes", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    const fakePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetch.mockResolvedValueOnce(mockBinaryResponse(fakePdf));

    const data = await aira.downloadComplianceReport("rep-1");
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(4);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("/compliance/reports/rep-1/download");
  });

  it("throws AiraError on non-OK response", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    await expect(aira.downloadComplianceReport("rep-bad")).rejects.toThrow(
      AiraError,
    );
  });

  it("throws AiraError in offline mode", async () => {
    const aira = new Aira({
      apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      baseUrl: "http://test",
      offline: true,
    });
    await expect(aira.downloadComplianceReport("rep-1")).rejects.toThrow(
      AiraError,
    );
  });
});

describe("verifyComplianceReport", () => {
  it("returns valid=true on signature match", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        report_id: "rep-1",
        valid: true,
        checks: { content_hash_matches: true, signature_valid: true },
        descriptor: { framework: "eu_ai_act_art12" },
        request_id: "req-3",
      }),
    );
    const result = await aira.verifyComplianceReport("rep-1");
    expect(result.valid).toBe(true);
    expect(result.checks.content_hash_matches).toBe(true);
  });
});

describe("getActionExplanation", () => {
  it("returns the explanation dict", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        action: { id: "act-1" },
        policy_chain: [],
        approval_chain: [],
        receipt: { receipt_id: "rec-1" },
        regulation: { framework: "eu_ai_act" },
        request_id: "req-4",
      }),
    );
    const explanation = await aira.getActionExplanation("act-1");
    expect((explanation.action as { id: string }).id).toBe("act-1");
    expect(explanation.receipt).not.toBeNull();
  });
});

describe("downloadActionExplanationPdf", () => {
  it("returns Uint8Array", async () => {
    const aira = new Aira({ apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", baseUrl: "http://test" });
    const fakePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockFetch.mockResolvedValueOnce(mockBinaryResponse(fakePdf));
    const data = await aira.downloadActionExplanationPdf("act-1");
    expect(data).toBeInstanceOf(Uint8Array);
  });
});
