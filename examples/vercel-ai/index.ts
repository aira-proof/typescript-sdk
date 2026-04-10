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

  // ── 1. wrapTool() — real authorization gate ─────────────────────
  // `wrapTool()` is the REAL gate: it calls authorize() before the tool
  // runs (blocking on POLICY_DENIED or pending_approval) and notarize()
  // after. This is the recommended integration point for Vercel AI.
  console.log("1. Tool call via wrapTool() (gated)");
  console.log("-".repeat(40));

  const rawSearch = async (...args: unknown[]): Promise<string> => {
    const q = (args[0] as { query: string }).query;
    return `Found 7 results for '${q}'`;
  };
  const webSearch = middleware.wrapTool(rawSearch, "web_search");

  try {
    const result = await webSearch({ query: "EU AI Act Article 12" });
    console.log(`   ✓ Gated + notarized: ${String(result).slice(0, 60)}...`);
  } catch (e) {
    console.log(`   ✗ Blocked: ${(e as Error).message}`);
  }

  // ── 2. onStepFinish / onFinish — AUDIT-ONLY callbacks ───────────
  // These fire AFTER the step/generation has run. They cannot gate
  // execution — they produce a post-hoc audit receipt.
  console.log("\n2. Post-hoc audit (onStepFinish / onFinish)");
  console.log("-".repeat(40));
  middleware.onStepFinish("tool-result", 340);
  console.log("   Audit: step_completed (tool-result, 340 tokens)");

  middleware.onStepFinish("text-delta", 128);
  console.log("   Audit: step_completed (text-delta, 128 tokens)");

  middleware.onFinish("stop", 468);
  console.log("   Audit: generation_completed (stop, 468 total tokens)");

  // ── 4. Verify the trail ──────────────────────────────────────────
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n4. Verify audit trail");
  console.log("-".repeat(40));
  const actions = await aira.listActions({ agentId: "vercel-ai-agent" });
  console.log(`   Total notarized actions: ${actions.total}`);

  if (actions.data.length > 0) {
    const latest = actions.data[0];
    const verify = await aira.verifyAction(latest.action_id);
    console.log(`   Valid: ${verify.valid}`);
    console.log(`   Signature key: ${verify.public_key_id}`);
    console.log(`   Receipt: ${verify.message.slice(0, 60)}...`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done — 1 gated tool + 3 audit events notarized");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
