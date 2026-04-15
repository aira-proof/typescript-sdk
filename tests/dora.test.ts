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

function mockBinaryResponse(status: number, bytes: Uint8Array) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  };
}

const INCIDENT_OK = {
  uuid: "i-1",
  title: "Outage",
  status: "detected",
  severity: null,
  category: null,
  is_major: false,
  detected_at: "2026-04-15T10:00:00Z",
  classified_at: null,
  resolved_at: null,
  reported_at: null,
  clients_affected_count: 1500,
  has_report: false,
  created_at: "2026-04-15T10:00:00Z",
  org_uuid: "org-1",
  description: "DB down",
  affected_services: ["api"],
  request_id: "req-1",
};

const THIRD_PARTY_OK = {
  uuid: "tp-1",
  org_uuid: "org-1",
  vendor_name: "AWS",
  service_description: "Cloud compute",
  service_type: "cloud_compute",
  criticality: "critical",
  contract_start_date: "2026-01-01",
  contract_end_date: null,
  exit_strategy_summary: "12-month exit plan",
  subcontractors: null,
  data_categories: null,
  jurisdiction: "US-EAST",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  request_id: "req-2",
};

function client(): Aira {
  return new Aira({
    apiKey: "aira_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    baseUrl: "http://test",
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createDoraIncident", () => {
  it("POSTs to /dora/incidents with snake_case body", async () => {
    const aira = client();
    mockFetch.mockResolvedValueOnce(mockJsonResponse(201, INCIDENT_OK));

    const incident = await aira.createDoraIncident({
      title: "Outage",
      description: "DB down",
      detectedAt: "2026-04-15T10:00:00Z",
      clientsAffectedCount: 1500,
      affectedServices: ["api"],
    });
    expect(incident.uuid).toBe("i-1");
    expect(incident.status).toBe("detected");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/dora/incidents");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      title: "Outage",
      description: "DB down",
      detected_at: "2026-04-15T10:00:00Z",
      clients_affected_count: 1500,
      affected_services: ["api"],
    });
  });
});

describe("classifyDoraIncident", () => {
  it("PUTs to /dora/incidents/:uuid/classify", async () => {
    const aira = client();
    const classified = {
      ...INCIDENT_OK,
      status: "classified",
      severity: "critical",
      category: "cyber_attack",
      is_major: true,
    };
    mockFetch.mockResolvedValueOnce(mockJsonResponse(200, classified));

    const incident = await aira.classifyDoraIncident("i-1", {
      severity: "critical",
      category: "cyber_attack",
    });
    expect(incident.is_major).toBe(true);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/dora/incidents/i-1/classify");
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ severity: "critical", category: "cyber_attack" });
  });
});

describe("listDoraIncidents", () => {
  it("passes filters as query string", async () => {
    const aira = client();
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse(200, {
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        request_id: "r",
      }),
    );

    await aira.listDoraIncidents({ severity: "critical", isMajor: true });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/dora/incidents");
    expect(url).toContain("severity=critical");
    expect(url).toContain("is_major=true");
  });
});

describe("downloadDoraIncidentReport", () => {
  it("GETs the report and returns raw PDF bytes", async () => {
    const aira = client();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetch.mockResolvedValueOnce(mockBinaryResponse(200, pdf));

    const bytes = await aira.downloadDoraIncidentReport("i-1");
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/dora/incidents/i-1/report");
    expect((init as RequestInit).method).toBe("GET");
  });
});

describe("createIctThirdParty", () => {
  it("POSTs to /dora/third-parties with snake_case body", async () => {
    const aira = client();
    mockFetch.mockResolvedValueOnce(mockJsonResponse(201, THIRD_PARTY_OK));

    const tp = await aira.createIctThirdParty({
      vendorName: "AWS",
      serviceDescription: "Cloud compute",
      serviceType: "cloud_compute",
      criticality: "critical",
      exitStrategySummary: "12-month exit plan",
    });
    expect(tp.vendor_name).toBe("AWS");
    expect(tp.criticality).toBe("critical");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test/api/v1/dora/third-parties");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.vendor_name).toBe("AWS");
    expect(body.service_type).toBe("cloud_compute");
    expect(body.exit_strategy_summary).toBe("12-month exit plan");
  });
});

describe("createDoraTest", () => {
  it("POSTs to /dora/tests with test_type field", async () => {
    const aira = client();
    const body = {
      uuid: "t-1",
      test_type: "tlpt",
      title: "Q1 penetration test",
      conducted_at: "2026-03-15",
      conducted_by: "Recurity Labs",
      status: "passed",
    };
    mockFetch.mockResolvedValueOnce(mockJsonResponse(201, body));

    const t = await aira.createDoraTest({
      testType: "tlpt",
      title: "Q1 penetration test",
      scope: "API + data plane",
      conductedAt: "2026-03-15",
      conductedBy: "Recurity Labs",
      status: "passed",
    });
    expect(t.test_type).toBe("tlpt");
    expect(t.status).toBe("passed");

    const [, init] = mockFetch.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.test_type).toBe("tlpt");
    expect(sent.conducted_by).toBe("Recurity Labs");
  });
});
