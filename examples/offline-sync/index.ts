/**
 * Aira Offline Mode — Queue authorize/notarize calls locally, sync later
 *
 * When initialized with `offline: true`, the Aira client queues all POST
 * requests in memory instead of sending them to the API. Call `aira.sync()`
 * when connectivity returns to flush the queue.
 *
 * IMPORTANT: in offline mode the two-step flow degrades to a best-effort
 * audit trail — you cannot know whether an `authorize()` would succeed until
 * you sync, so use this mode only for actions that the agent will execute
 * regardless (e.g. local scans, sensor readings), not for actions that
 * depend on Aira's authorization decision.
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

  console.log("1. Queue authorize() calls (offline)");
  console.log("-".repeat(40));

  // In offline mode, authorize() queues the request locally and returns a
  // placeholder with a _queue_id. No network calls are made. On sync(), the
  // backend runs the real authorization and returns the Authorization
  // responses that would have been returned at call time.
  const r1 = await aira.authorize({
    actionType: "scan_completed",
    details: "Batch #1 — scanned 142 documents for PII",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #1)  [${(r1 as unknown as Record<string, unknown>)._queue_id}]`);

  const r2 = await aira.authorize({
    actionType: "scan_completed",
    details: "Batch #2 — scanned 89 invoices for anomalies",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #2)  [${(r2 as unknown as Record<string, unknown>)._queue_id}]`);

  const r3 = await aira.authorize({
    actionType: "scan_completed",
    details: "Batch #3 — scanned 203 contracts for compliance clauses",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: scan_completed (Batch #3)  [${(r3 as unknown as Record<string, unknown>)._queue_id}]`);

  const r4 = await aira.authorize({
    actionType: "report_generated",
    details: "Summary report: 434 documents processed, 12 issues found",
    agentId: "scanner-agent",
    modelId: "claude-sonnet-4-6",
  });
  console.log(`   Queued: report_generated           [${(r4 as unknown as Record<string, unknown>)._queue_id}]`);

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

  // ── 4. Inspect the authorizations and notarize their outcomes ───
  console.log("\n3. Authorizations from sync");
  console.log("-".repeat(40));

  // After sync, each result is an Authorization. The agent now needs to
  // notarize the outcome of each action (we switch to an online client
  // because the second leg is a sequential per-action_uuid POST).
  const onlineAira = new Aira({ apiKey: AIRA_API_KEY! });
  const receipts: Record<string, unknown>[] = [];
  for (let i = 0; i < results.length; i++) {
    const authResult = results[i];
    const actionId = authResult.action_uuid as string | undefined;
    const status = (authResult.status as string) ?? "unknown";
    console.log(`   [${i + 1}] ${(actionId ?? "n/a").slice(0, 20)}...  status: ${status}`);

    if (status === "authorized" && actionId) {
      const receipt = await onlineAira.notarize({ actionId, outcome: "completed" });
      receipts.push(receipt as unknown as Record<string, unknown>);
    }
  }

  // ── 5. Verify one of the receipts ───────────────────────────────
  console.log("\n4. Verify receipt");
  console.log("-".repeat(40));

  if (receipts.length > 0 && receipts[0].action_uuid) {
    const verify = await onlineAira.verifyAction(receipts[0].action_uuid as string);
    console.log(`   Valid:     ${verify.valid}`);
    console.log(`   Key:       ${verify.public_key_id}`);
    console.log(`   Receipt:   ${verify.message.slice(0, 50)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Done — queued 4 actions offline, synced, ${receipts.length} receipts`);
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
