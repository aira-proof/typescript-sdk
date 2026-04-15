/**
 * Aira Webhook Server — Receive and verify webhook events
 *
 * An Express server that receives Aira webhook events with HMAC-SHA256
 * signature verification. Aira sends webhooks for events like:
 *   - action.notarized     — new cryptographic receipt created
 *   - case.complete        — multi-model consensus finished
 *   - evidence.sealed      — evidence package sealed
 *   - escrow.deposited     — escrow funds committed
 *   - compliance.snapshot_created — new compliance snapshot
 *
 * Usage:
 *   npm install aira-sdk express
 *   export AIRA_WEBHOOK_SECRET="whsec_xxx"
 *   npx tsx examples/webhook-server/index.ts
 */

import express from "express";
import { verifySignature, parseEvent, WebhookEventType } from "aira-sdk/extras/webhooks";

// ── Setup ────────────────────────────────────────────────────────────
const WEBHOOK_SECRET = process.env.AIRA_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error("Error: Set AIRA_WEBHOOK_SECRET environment variable");
  console.error("  Find your webhook secret at https://app.airaproof.com/dashboard/webhooks");
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? "5000", 10);
const app = express();

// ── Webhook endpoint ─────────────────────────────────────────────────
// IMPORTANT: Use express.raw() to get the raw Buffer for signature
// verification. Using express.json() would re-serialize the body and
// break the HMAC check.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-aira-signature"] as string;

  // Step 1: Verify the HMAC-SHA256 signature to ensure this request
  // actually came from Aira and wasn't tampered with.
  if (!signature || !verifySignature(req.body, signature, WEBHOOK_SECRET!)) {
    console.warn("  REJECTED: Invalid or missing signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Step 2: Parse the raw payload into a typed WebhookEvent.
  const event = parseEvent(req.body);

  console.log(`  Received: ${event.eventType}`);
  console.log(`  Delivery: ${event.deliveryId ?? "n/a"}`);
  console.log(`  Time:     ${event.timestamp ?? "n/a"}`);

  // Step 3: Route the event to the appropriate handler.
  switch (event.eventType) {
    case WebhookEventType.ACTION_NOTARIZED: {
      const data = event.data;
      console.log(`  -> Action notarized: ${data.action_uuid}`);
      console.log(`     Type: ${data.action_type}, Agent: ${data.agent_id}`);
      break;
    }

    case WebhookEventType.CASE_COMPLETE: {
      const data = event.data;
      console.log(`  -> Case completed: ${data.case_id}`);
      console.log(`     Decision: ${(data.consensus as Record<string, unknown>)?.decision ?? "N/A"}`);
      break;
    }

    case WebhookEventType.CASE_REQUIRES_REVIEW: {
      const data = event.data;
      console.log(`  -> Case needs human review: ${data.case_id}`);
      console.log(`     Reason: ${data.reason ?? "Models disagreed"}`);
      break;
    }

    case WebhookEventType.EVIDENCE_SEALED: {
      const data = event.data;
      console.log(`  -> Evidence sealed: ${data.package_uuid}`);
      console.log(`     Title: ${data.title}`);
      break;
    }

    case WebhookEventType.ESCROW_DEPOSITED: {
      const data = event.data;
      console.log(`  -> Escrow deposit: ${data.amount} ${data.currency}`);
      break;
    }

    case WebhookEventType.ESCROW_RELEASED: {
      const data = event.data;
      console.log(`  -> Escrow released: ${data.amount} ${data.currency}`);
      break;
    }

    case WebhookEventType.ESCROW_DISPUTED: {
      const data = event.data;
      console.log(`  -> Escrow disputed: ${data.amount} ${data.currency}`);
      console.log(`     Reason: ${data.description}`);
      break;
    }

    case WebhookEventType.COMPLIANCE_SNAPSHOT: {
      const data = event.data;
      console.log(`  -> Compliance snapshot: ${data.framework}`);
      console.log(`     Status: ${data.status}`);
      break;
    }

    case WebhookEventType.AGENT_REGISTERED: {
      const data = event.data;
      console.log(`  -> Agent registered: ${data.agent_slug}`);
      break;
    }

    case WebhookEventType.AGENT_DECOMMISSIONED: {
      const data = event.data;
      console.log(`  -> Agent decommissioned: ${data.agent_slug}`);
      break;
    }

    default:
      console.log(`  -> Unhandled event type: ${event.eventType}`);
      console.log(`     Data: ${JSON.stringify(event.data).slice(0, 100)}`);
  }

  console.log("");

  // Always respond 200 quickly — Aira retries on non-2xx responses.
  res.json({ status: "ok" });
});

// ── Health check ─────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ── Start server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira Webhook Server");
  console.log("=".repeat(60));
  console.log(`  Listening:  http://localhost:${PORT}/webhook`);
  console.log(`  Health:     http://localhost:${PORT}/health`);
  console.log(`  Secret:     ${WEBHOOK_SECRET!.slice(0, 10)}...`);
  console.log("");
  console.log("  Supported events:");
  for (const [key, value] of Object.entries(WebhookEventType)) {
    console.log(`    - ${value} (${key})`);
  }
  console.log("\n  Waiting for events...\n");
});
