/**
 * Aira + Vercel AI SDK — Auto-notarize tool calls and completions
 *
 * AiraVercelMiddleware wraps Vercel AI SDK's streamText/generateText
 * callbacks to notarize every step, tool call, and final generation
 * with a cryptographic receipt.
 *
 * Usage:
 *   npm install aira-sdk
 *   export AIRA_API_KEY="aira_live_xxx"
 *   npx tsx examples/vercel-ai/index.ts
 */

import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";

// ── Setup ────────────────────────────────────────────────────────────
const AIRA_API_KEY = process.env.AIRA_API_KEY;
if (!AIRA_API_KEY) {
  console.error("Error: Set AIRA_API_KEY environment variable");
  console.error("  Get your key at https://app.airaproof.com/dashboard/api-keys");
  process.exit(1);
}

const aira = new Aira({ apiKey: AIRA_API_KEY });

// Create middleware — notarizes every Vercel AI SDK event automatically.
const middleware = new AiraVercelMiddleware(aira, "vercel-ai-agent", {
  modelId: "gpt-5.2",
});

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira + Vercel AI SDK — Notarization Demo");
  console.log("=".repeat(60) + "\n");

  // ── 1. Simulate a tool call + result ─────────────────────────────
  // In a real app, use middleware.wrapTool() to auto-notarize:
  //
  //   const wrappedSearch = middleware.wrapTool(searchFn, "web_search");
  //   const result = await wrappedSearch({ query: "..." });
  //
  // Here we call the methods directly to demonstrate.

  console.log("1. Tool call: web_search");
  console.log("-".repeat(40));
  middleware.onToolCall("web_search", ["query", "max_results"]);
  console.log("   Notarized: tool_call for 'web_search'");

  middleware.onToolResult("web_search", 1250);
  console.log("   Notarized: tool_completed (1250 chars result)");

  // ── 2. Simulate step completion ──────────────────────────────────
  console.log("\n2. Step completion");
  console.log("-".repeat(40));
  middleware.onStepFinish("tool-result", 340);
  console.log("   Notarized: step_completed (tool-result, 340 tokens)");

  middleware.onStepFinish("text-delta", 128);
  console.log("   Notarized: step_completed (text-delta, 128 tokens)");

  // ── 3. Simulate full generation completion ───────────────────────
  console.log("\n3. Generation completed");
  console.log("-".repeat(40));
  middleware.onFinish("stop", 468);
  console.log("   Notarized: generation_completed (stop, 468 total tokens)");

  // ── 4. Verify the trail ──────────────────────────────────────────
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n4. Verify audit trail");
  console.log("-".repeat(40));
  const actions = await aira.listActions({ agentId: "vercel-ai-agent" });
  console.log(`   Total notarized actions: ${actions.total}`);

  if (actions.data.length > 0) {
    const latest = actions.data[0];
    const actionId = (latest as Record<string, unknown>).action_id as string;

    const verify = await aira.verifyAction(actionId);
    console.log(`   Valid: ${verify.valid}`);
    console.log(`   Signature key: ${verify.public_key_id}`);
    console.log(`   Receipt: ${verify.message.slice(0, 60)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done — 5 actions notarized with cryptographic receipts");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
