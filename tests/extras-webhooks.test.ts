import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySignature, parseEvent, WebhookEventType } from "../src/extras/webhooks";

const SECRET = "whsec_test_secret_123";

function sign(payload: string, secret = SECRET): string {
  const digest = createHmac("sha256", secret).update(payload, "utf-8").digest("hex");
  return `sha256=${digest}`;
}

describe("verifySignature", () => {
  it("returns true for valid signature", () => {
    const payload = '{"event":"action.notarized","data":{}}';
    const sig = sign(payload);
    expect(verifySignature(payload, sig, SECRET)).toBe(true);
  });

  it("returns true for Buffer payload", () => {
    const payload = '{"event":"action.notarized"}';
    const sig = sign(payload);
    expect(verifySignature(Buffer.from(payload), sig, SECRET)).toBe(true);
  });

  it("returns false for wrong signature", () => {
    const payload = '{"event":"action.notarized"}';
    expect(verifySignature(payload, "sha256=0000000000", SECRET)).toBe(false);
  });

  it("returns false for missing sha256= prefix", () => {
    const payload = '{"event":"action.notarized"}';
    const digest = createHmac("sha256", SECRET).update(payload).digest("hex");
    expect(verifySignature(payload, digest, SECRET)).toBe(false);
  });

  it("returns false for wrong secret", () => {
    const payload = '{"event":"action.notarized"}';
    const sig = sign(payload, "wrong_secret");
    expect(verifySignature(payload, sig, SECRET)).toBe(false);
  });

  it("returns false for tampered payload", () => {
    const payload = '{"event":"action.notarized"}';
    const sig = sign(payload);
    expect(verifySignature(payload + "x", sig, SECRET)).toBe(false);
  });
});

describe("parseEvent", () => {
  it("parses valid payload", () => {
    const payload = JSON.stringify({
      event: "action.notarized",
      data: { action_uuid: "act-1" },
      timestamp: "2026-01-01T00:00:00Z",
      delivery_id: "del-1",
    });

    const event = parseEvent(payload);
    expect(event.eventType).toBe("action.notarized");
    expect(event.data).toEqual({ action_uuid: "act-1" });
    expect(event.timestamp).toBe("2026-01-01T00:00:00Z");
    expect(event.deliveryId).toBe("del-1");
  });

  it("parses Buffer payload", () => {
    const payload = Buffer.from(JSON.stringify({ event: "agent.registered", data: {} }));
    const event = parseEvent(payload);
    expect(event.eventType).toBe("agent.registered");
  });

  it("defaults eventType to unknown", () => {
    const event = parseEvent(JSON.stringify({ data: {} }));
    expect(event.eventType).toBe("unknown");
  });

  it("uses full payload as data when data field missing", () => {
    const event = parseEvent(JSON.stringify({ event: "test", foo: "bar" }));
    expect(event.data).toEqual({ event: "test", foo: "bar" });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseEvent("not json")).toThrow("Invalid webhook payload");
  });
});

describe("WebhookEventType", () => {
  it("contains expected event types", () => {
    expect(WebhookEventType.ACTION_NOTARIZED).toBe("action.notarized");
    expect(WebhookEventType.CASE_COMPLETE).toBe("case.complete");
    expect(WebhookEventType.ESCROW_DEPOSITED).toBe("escrow.deposited");
    expect(WebhookEventType.COMPLIANCE_SNAPSHOT).toBe("compliance.snapshot_created");
  });
});
