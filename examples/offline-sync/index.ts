/**
 * Aira Offline Mode — Queue actions locally, sync later
 *
 * When initialized with `offline: true`, the Aira client queues all
 * POST requests (notarize, registerAgent, etc.) in memory instead of
 * sending them to the API. Call `aira.sync()` when connectivity is
 * available to flush the queue and get back real cryptographic receipts.
 *
 * Use cases:
 *   - Edge/IoT agents with intermittent connectivity
 *   - Batch processing with a single sync at the end
 *   - Testing without hitting the API on every call
 *
 * Usage:
 *   npm install aira-sdk
 *   export AIRA_API_KEY="aira_live_xxx"
 *   npx tsx examples/offline-sync/index.ts
 */

import { Aira } from "aira-sdk";

// ── Setup ────────────────────────────────────────────────────────────
const AIRA_API_KEY = process.env.AIRA_API_KEY;
if (!AIRA_API_KEY) {
  console.error("Error: Set AIRA_API_KEY environment variable");
  console.error("  Get your key at https://app.airaproof.com/dashboard/api-keys");
  process.exit(1);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira Offline Mode — Queue & Sync Demo");
  console.log("=".repeat(60) + "\n");

  // ── 1. Create an offline client ──────────────────────────────────
  // The `offline: true` flag tells the client to queue all writes
  // instead of sending them to the API immediately.
  const aira = new Aira({ apiKey: AIRA_API_KEY!, offline: true });

  console.log("1. Queue actions (offline)");
  console.log("-".repeat(40));

  // These calls return immediately with placeholder receipts.
  // No network requests are made.
  const r1 = await aira.notarize({
    actionType: "scan_completed",
    details: "Batch #1 — scanned 142 documents for PII",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #1)  [${(r1 as Record<string, unknown>)._queue_id}]`);

  const r2 = await aira.notarize({
    actionType: "scan_completed",
    details: "Batch #2 — scanned 89 invoices for anomalies",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #2)  [${(r2 as Record<string, unknown>)._queue_id}]`);

  const r3 = await aira.notarize({
    actionType: "scan_completed",
    details: "Batch #3 — scanned 203 contracts for compliance clauses",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #3)  [${(r3 as Record<string, unknown>)._queue_id}]`);

  const r4 = await aira.notarize({
    actionType: "report_generated",
    details: "Summary report: 434 documents processed, 12 issues found",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: report_generated           [${(r4 as Record<string, unknown>)._queue_id}]`);

  // ── 2. Check pending count ───────────────────────────────────────
  console.log(`\n   Pending: ${aira.pendingCount} actions queued`);
  console.log("   (No network requests made yet)");

  // ── 3. Sync to the API ──────────────────────────────────────────
  // When connectivity is available, flush the queue. Each queued
  // request is sent to the API sequentially and returns a real
  // cryptographic receipt.
  console.log("\n2. Sync to API");
  console.log("-".repeat(40));
  console.log("   Flushing queue...");

  const results = await aira.sync();

  console.log(`   Synced: ${results.length} actions`);
  console.log(`   Pending after sync: ${aira.pendingCount}`);

  // ── 4. Inspect the receipts ──────────────────────────────────────
  console.log("\n3. Cryptographic receipts");
  console.log("-".repeat(40));

  for (let i = 0; i < results.length; i++) {
    const receipt = results[i];
    const actionId = (receipt.action_id as string) ?? "n/a";
    const signature = (receipt.signature as string) ?? "n/a";
    console.log(`   [${i + 1}] ${actionId.slice(0, 20)}...  sig: ${signature.slice(0, 25)}...`);
  }

  // ── 5. Verify one of the receipts ───────────────────────────────
  console.log("\n4. Verify receipt");
  console.log("-".repeat(40));

  if (results.length > 0 && results[0].action_id) {
    // Verification is a public GET — works even after switching
    // back from offline mode. Create a new online client for this.
    const onlineAira = new Aira({ apiKey: AIRA_API_KEY! });
    const verify = await onlineAira.verifyAction(results[0].action_id as string);
    console.log(`   Valid:     ${verify.valid}`);
    console.log(`   Key:       ${verify.public_key_id}`);
    console.log(`   Receipt:   ${verify.message.slice(0, 50)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done — queued 4 actions offline, synced with receipts");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
