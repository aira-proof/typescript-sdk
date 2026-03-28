/**
 * Aira Lending Agent — Complete TypeScript SDK Example
 *
 * Covers every feature of aira-sdk: notarization, agents, cases, evidence,
 * estate, escrow, chat, verification, and error handling.
 *
 * Usage:
 *   npm install aira-sdk
 *   export AIRA_API_KEY="aira_live_xxx"
 *   npx tsx examples/lending-agent/index.ts
 */

import { Aira, AiraError } from "aira-sdk";

const AIRA_API_KEY = process.env.AIRA_API_KEY;
const AIRA_BASE_URL = process.env.AIRA_BASE_URL ?? "https://api.airaproof.com";
const AGENT_SLUG = "lending-agent-ts";
const MODEL_ID = "claude-sonnet-4-6";

if (!AIRA_API_KEY) {
  console.error("Error: Set AIRA_API_KEY environment variable");
  console.error("  Get your key at https://app.airaproof.com/dashboard/api-keys");
  process.exit(1);
}

const aira = new Aira({ apiKey: AIRA_API_KEY, baseUrl: AIRA_BASE_URL });

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira Lending Agent — TypeScript SDK Demo");
  console.log("=".repeat(60) + "\n");

  // ══════════════════════════════════════════════════════════
  // 1. AGENT REGISTRY
  // ══════════════════════════════════════════════════════════

  console.log("1. Agent Registry");
  console.log("-".repeat(40));
  try {
    const agent = await aira.registerAgent({
      agentSlug: AGENT_SLUG,
      displayName: "Loan Decision Engine (TS)",
      description: "TypeScript lending agent with multi-factor risk assessment",
      capabilities: ["credit_scoring", "risk_assessment"],
      public: true,
    });
    console.log(`   ✓ Registered: ${agent.agent_slug}`);

    await aira.publishVersion(AGENT_SLUG, {
      version: "1.0.0",
      modelId: MODEL_ID,
      changelog: "Initial TypeScript release",
    });
    console.log("   ✓ Version: 1.0.0");
  } catch (e) {
    if (e instanceof AiraError && e.code.includes("EXISTS")) {
      console.log("   ✓ Already registered (skipped)");
    } else throw e;
  }

  try {
    await aira.updateAgent(AGENT_SLUG, { description: "TS lending agent v1.0" });
    console.log("   ✓ Updated description");
  } catch { /* ignore */ }

  const agents = await aira.listAgents();
  console.log(`   ✓ ${agents.total} agent(s) in registry`);

  const detail = await aira.getAgent(AGENT_SLUG);
  console.log(`   ✓ Status: ${detail.status}`);

  const versions = await aira.listVersions(AGENT_SLUG);
  console.log(`   ✓ ${versions.length} version(s)`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // 2. NOTARIZATION
  // ══════════════════════════════════════════════════════════

  console.log("2. Action Notarization");
  console.log("-".repeat(40));

  const receipt = await aira.notarize({
    actionType: "loan_decision",
    details: JSON.stringify({
      applicant: "Maria Schmidt",
      amount: 15000,
      decision: "APPROVED",
      confidence: 0.91,
    }),
    agentId: AGENT_SLUG,
    modelId: MODEL_ID,
    idempotencyKey: `loan-maria-ts-${Date.now()}`,
  });
  console.log(`   ✓ Notarized: ${receipt.action_id.slice(0, 16)}...`);
  console.log(`   ✓ Signature: ${receipt.signature.slice(0, 30)}...`);
  const actionIds = [receipt.action_id];

  // Chain of custody
  const emailReceipt = await aira.notarize({
    actionType: "email_sent",
    details: JSON.stringify({ to: "maria@example.de", subject: "Loan Approved" }),
    agentId: AGENT_SLUG,
    modelId: MODEL_ID,
    parentActionId: receipt.action_id,
  });
  console.log(`   ✓ Chained: ${emailReceipt.action_id.slice(0, 16)}...`);
  actionIds.push(emailReceipt.action_id);

  const action = await aira.getAction(receipt.action_id);
  console.log(`   ✓ Type: ${action.action_type}`);

  const chain = await aira.getActionChain(receipt.action_id);
  console.log(`   ✓ Chain: ${chain.length} action(s)`);

  const actions = await aira.listActions({ actionType: "loan_decision" });
  console.log(`   ✓ Loan decisions: ${actions.total}`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // 3. CASES
  // ══════════════════════════════════════════════════════════

  console.log("3. Multi-Model Consensus");
  console.log("-".repeat(40));
  try {
    const caseResult = await aira.runCase(
      "Should we approve a €15,000 loan? Credit: 742, income: €45,000",
      [MODEL_ID, "gpt-4o"],
    );
    const consensus = caseResult.consensus as Record<string, unknown>;
    console.log(`   ✓ Decision: ${consensus?.decision ?? "N/A"}`);
    console.log(`   ✓ Confidence: ${consensus?.confidence_score ?? "N/A"}`);

    const cases = await aira.listCases();
    console.log(`   ✓ Total cases: ${cases.total}`);
  } catch (e) {
    if (e instanceof AiraError) console.log(`   ⚠ Skipped: ${e.message}`);
  }
  console.log();

  // ══════════════════════════════════════════════════════════
  // 4. EVIDENCE
  // ══════════════════════════════════════════════════════════

  console.log("4. Evidence & Discovery");
  console.log("-".repeat(40));

  const pkg = await aira.createEvidencePackage({
    title: "Loan Decision — Maria Schmidt (TS)",
    actionIds,
    description: "Audit trail for €15,000 loan approval",
  });
  console.log(`   ✓ Sealed: "${pkg.title}"`);
  console.log(`   ✓ Hash: ${pkg.package_hash.slice(0, 30)}...`);

  const packages = await aira.listEvidencePackages();
  console.log(`   ✓ Total packages: ${packages.total}`);

  const retrieved = await aira.getEvidencePackage(pkg.id);
  console.log(`   ✓ Retrieved: ${retrieved.title}`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // 5. ESTATE
  // ══════════════════════════════════════════════════════════

  console.log("5. Agent Estate & Compliance");
  console.log("-".repeat(40));

  try {
    await aira.setAgentWill(AGENT_SLUG, {
      successorSlug: AGENT_SLUG,
      successionPolicy: "transfer_to_successor",
      dataRetentionDays: 2555,
      notifyEmails: ["compliance@example.com"],
    });
    console.log("   ✓ Will set: 2555-day retention");
  } catch {
    console.log("   ✓ Will exists");
  }

  const will = await aira.getAgentWill(AGENT_SLUG);
  console.log(`   ✓ Policy: ${(will as Record<string, unknown>).succession_policy ?? "N/A"}`);

  const snapshot = await aira.createComplianceSnapshot({
    framework: "eu-ai-act",
    agentSlug: AGENT_SLUG,
    findings: { art_12_logging: "pass", art_14_oversight: "pass" },
  });
  console.log(`   ✓ EU AI Act: ${snapshot.status}`);

  const snapshots = await aira.listComplianceSnapshots({ framework: "eu-ai-act" });
  console.log(`   ✓ Snapshots: ${snapshots.total}`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // 6. ESCROW
  // ══════════════════════════════════════════════════════════

  console.log("6. Escrow (Liability Commitments)");
  console.log("-".repeat(40));
  try {
    const account = await aira.createEscrowAccount({ purpose: "Loan liability — TS demo" });
    console.log(`   ✓ Account: ${account.id.slice(0, 16)}...`);

    await aira.escrowDeposit(account.id, 1500, "Liability commitment");
    console.log("   ✓ Committed: €1,500");

    await aira.escrowRelease(account.id, 1500, "Loan disbursed");
    console.log("   ✓ Released: €1,500");

    const accounts = await aira.listEscrowAccounts();
    console.log(`   ✓ Accounts: ${accounts.total}`);
  } catch (e) {
    if (e instanceof AiraError) console.log(`   ⚠ Skipped: ${e.message}`);
  }
  console.log();

  // ══════════════════════════════════════════════════════════
  // 7. CHAT
  // ══════════════════════════════════════════════════════════

  console.log("7. Ask Aira");
  console.log("-".repeat(40));
  try {
    const response = await aira.ask("How many loan decisions were notarized today?");
    console.log(`   ✓ ${response.content.slice(0, 80)}...`);
  } catch (e) {
    if (e instanceof AiraError) console.log(`   ⚠ Skipped: ${e.message}`);
  }
  console.log();

  // ══════════════════════════════════════════════════════════
  // 8. VERIFICATION
  // ══════════════════════════════════════════════════════════

  console.log("8. Public Verification");
  console.log("-".repeat(40));
  const verify = await aira.verifyAction(receipt.action_id);
  console.log(`   ✓ Valid: ${verify.valid}`);
  console.log(`   ✓ Key: ${verify.public_key_id}`);
  console.log(`   ✓ ${verify.message.slice(0, 60)}...`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // 9. ERROR HANDLING
  // ══════════════════════════════════════════════════════════

  console.log("9. Error Handling");
  console.log("-".repeat(40));
  try {
    await aira.verifyAction("00000000-0000-0000-0000-000000000000");
  } catch (e) {
    if (e instanceof AiraError) {
      console.log(`   ✓ Caught: [${e.code}] ${e.message}`);
    }
  }
  console.log();

  // ══════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("  All 9 feature areas demonstrated.");
  console.log("  Dashboard: https://app.airaproof.com");
  console.log("  Docs:      https://docs.airaproof.com");
  console.log("  SDK:       npm install aira-sdk");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
