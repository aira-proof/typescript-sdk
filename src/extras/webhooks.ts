/**
 * Webhook signature verification and event parsing for Aira webhooks.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** Known Aira webhook event types. */
export const WebhookEventType = {
  CASE_COMPLETE: "case.complete",
  CASE_REQUIRES_REVIEW: "case.requires_human_review",
  ACTION_NOTARIZED: "action.notarized",
  ACTION_AUTHORIZED: "action.authorized",
  AGENT_REGISTERED: "agent.registered",
  AGENT_DECOMMISSIONED: "agent.decommissioned",
  EVIDENCE_SEALED: "evidence.sealed",
  ESCROW_DEPOSITED: "escrow.deposited",
  ESCROW_RELEASED: "escrow.released",
  ESCROW_DISPUTED: "escrow.disputed",
  COMPLIANCE_SNAPSHOT: "compliance.snapshot_created",
} as const;

export type WebhookEventTypeName = (typeof WebhookEventType)[keyof typeof WebhookEventType];

/** Parsed webhook event. */
export interface WebhookEvent {
  eventType: string;
  data: Record<string, unknown>;
  timestamp?: string;
  deliveryId?: string;
}

/**
 * Verify webhook signature.
 * Signature format: sha256={hex_digest}
 */
export function verifySignature(payload: Buffer | string, signature: string, secret: string): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const payloadBuf = typeof payload === "string" ? Buffer.from(payload, "utf-8") : payload;
  const expected = createHmac("sha256", secret).update(payloadBuf).digest("hex");
  const expectedSig = `sha256=${expected}`;

  // Constant-time comparison
  try {
    return timingSafeEqual(Buffer.from(signature, "utf-8"), Buffer.from(expectedSig, "utf-8"));
  } catch {
    return false;
  }
}

/**
 * Parse raw webhook payload into a WebhookEvent.
 */
export function parseEvent(payload: Buffer | string): WebhookEvent {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf-8"));
  } catch (e) {
    throw new Error(`Invalid webhook payload: ${e}`);
  }

  return {
    eventType: (data.event as string) ?? "unknown",
    data: (data.data as Record<string, unknown>) ?? data,
    timestamp: data.timestamp as string | undefined,
    deliveryId: data.delivery_id as string | undefined,
  };
}
