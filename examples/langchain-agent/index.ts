/**
 * Aira + LangChain.js — Auto-notarize agent tool calls and completions
 *
 * The AiraCallbackHandler hooks into LangChain's callback system to
 * notarize every tool call, chain completion, and LLM generation with
 * a cryptographic receipt on Aira's tamper-proof ledger.
 *
 * Usage:
 *   npm install aira-sdk
 *   export AIRA_API_KEY="aira_live_xxx"
 *   npx tsx examples/langchain-agent/index.ts
 */

import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

// ── Setup ────────────────────────────────────────────────────────────
const AIRA_API_KEY = process.env.AIRA_API_KEY;
if (!AIRA_API_KEY) {
  console.error("Error: Set AIRA_API_KEY environment variable");
  console.error("  Get your key at https://app.airaproof.com/dashboard/api-keys");
  process.exit(1);
}

const aira = new Aira({ apiKey: AIRA_API_KEY });

// Create a callback handler — every LangChain event it receives is
// automatically notarized with a cryptographic receipt.
// The trustPolicy enables automated trust checks before agent interactions.
const handler = new AiraCallbackHandler(aira, "langchain-research-agent", {
  modelId: "gpt-4o",
  trustPolicy: {
    verifyCounterparty: true,    // Resolve DID before interacting
    minReputation: 50,           // Warn if reputation < 50
    requireValidVc: true,        // Check Verifiable Credential validity
    blockRevokedVc: true,        // Hard-block agents with revoked credentials
    blockUnregistered: false,    // Advisory only for unregistered agents
  },
});

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira + LangChain.js — Notarization Demo");
  console.log("=".repeat(60) + "\n");

  // ── 0. Trust check — verify counterparty before interacting ─────
  // In a multi-agent workflow, check trust before delegating work.
  console.log("0. Trust check: partner-data-agent");
  console.log("-".repeat(40));
  const trust = await handler.checkTrust("partner-data-agent");
  if (trust.blocked) {
    console.log(`   BLOCKED: ${trust.blockReason}`);
    console.log("   Aborting interaction with untrusted agent.");
    return;
  }
  console.log(`   DID resolved: ${trust.didResolved ?? "skipped"}`);
  console.log(`   VC valid: ${trust.vcValid ?? "skipped"}`);
  console.log(`   Reputation: ${trust.reputationScore ?? "unknown"} (${trust.reputationTier ?? "unknown"})`);
  if (trust.recommendation) {
    console.log(`   Advisory: ${trust.recommendation}`);
  }
  console.log("   Trust check passed — proceeding.\n");

  // ── 1. Simulate a tool call ──────────────────────────────────────
  // In a real LangChain app, you'd pass `handler.asCallbacks()` to
  // your chain:
  //   const chain = someChain.withConfig({ callbacks: [handler.asCallbacks()] });
  //
  // Here we call the handler methods directly to show what happens.

  console.log("1. Tool call: search_docs");
  console.log("-".repeat(40));
  handler.handleToolEnd("Found 3 documents matching 'EU AI Act compliance'", "search_docs");
  console.log("   Notarized: tool_call for 'search_docs'");

  // ── 2. Simulate a chain completion ───────────────────────────────
  console.log("\n2. Chain completion");
  console.log("-".repeat(40));
  handler.handleChainEnd({
    output: "Analysis complete: 3 documents reviewed, 2 compliance gaps found",
    sources: ["doc_1", "doc_2", "doc_3"],
  });
  console.log("   Notarized: chain_completed with output keys [output, sources]");

  // ── 3. Simulate an LLM generation ───────────────────────────────
  console.log("\n3. LLM generation");
  console.log("-".repeat(40));
  handler.handleLLMEnd(2);
  console.log("   Notarized: llm_completion with 2 generations");

  // ── 4. Verify the trail ──────────────────────────────────────────
  // Give the async notarizations a moment to complete.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n4. Verify audit trail");
  console.log("-".repeat(40));
  const actions = await aira.listActions({ agentId: "langchain-research-agent" });
  console.log(`   Total notarized actions: ${actions.total}`);

  if (actions.data.length > 0) {
    const latest = actions.data[0];
    console.log(`   Latest action: ${(latest as Record<string, unknown>).action_type}`);
    const actionId = (latest as Record<string, unknown>).action_id as string;

    // Cryptographic verification — public, no auth needed
    const verify = await aira.verifyAction(actionId);
    console.log(`   Valid: ${verify.valid}`);
    console.log(`   Signature key: ${verify.public_key_id}`);
    console.log(`   Receipt: ${verify.message.slice(0, 60)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done — 3 actions notarized with cryptographic receipts");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
