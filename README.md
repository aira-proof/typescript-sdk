# Aira TypeScript SDK

**Legal infrastructure for AI agents.** Cryptographic proof for every action your AI agent takes.

Aira provides the accountability layer that autonomous AI agents need to operate in regulated environments. Every action is notarized with Ed25519 signatures and RFC 3161 timestamps — producing court-admissible proof that an action happened, who authorized it, and what decision was made.

**What you get:**
- **Notarize actions** — cryptographic receipts for every agent decision, email, transaction
- **Register agents** — verifiable identity with versioned configs and public profiles
- **Multi-model consensus** — run the same decision through multiple AI models, flag disagreements
- **Evidence packages** — sealed, tamper-proof bundles for legal discovery and audit
- **Agent lifecycle** — wills, succession plans, death certificates, compliance snapshots
- **Liability commitments** — record accountability commitments with cryptographic proof
- **Human authorization** — require human co-signatures on high-stakes actions
- **Public verification** — anyone can verify a receipt without an account

Built for EU AI Act, SR 11-7, and GDPR compliance. Self-hostable. Open-source SDK.

[![npm version](https://img.shields.io/npm/v/aira-sdk.svg)](https://www.npmjs.com/package/aira-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

```bash
npm install aira-sdk
```

## Quick Start

```typescript
import { Aira } from "aira-sdk";

const aira = new Aira({ apiKey: "aira_live_xxx" });

// Notarize an agent action
const receipt = await aira.notarize({
  actionType: "email_sent",
  details: "Sent onboarding email to customer@example.com",
  agentId: "support-agent",
  modelId: "claude-sonnet-4-6",
});

console.log(receipt.signature);  // ed25519:base64url...
console.log(receipt.action_id);  // uuid
```

## Agent Registry

```typescript
const agent = await aira.registerAgent({
  agentSlug: "lending-agent",
  displayName: "Loan Decision Engine",
  capabilities: ["credit_scoring", "risk_assessment"],
  public: true,
});

await aira.publishVersion("lending-agent", {
  version: "1.0.0",
  modelId: "claude-sonnet-4-6",
  changelog: "Initial release",
});

const agents = await aira.listAgents();
console.log(agents.total);  // 5
```

## Action Notarization

```typescript
// Notarize with chain of custody
const decision = await aira.notarize({
  actionType: "loan_approved",
  details: "Approved loan #4521 for €25,000",
  agentId: "lending-agent",
  modelId: "claude-sonnet-4-6",
  idempotencyKey: "loan-4521",
});

// Chain a follow-up action
const email = await aira.notarize({
  actionType: "email_sent",
  details: "Sent approval notification",
  agentId: "lending-agent",
  parentActionId: decision.action_id,
});

// Get chain of custody
const chain = await aira.getActionChain(decision.action_id);

// Human co-signature
await aira.authorizeAction(decision.action_id);

// Legal hold
await aira.setLegalHold(decision.action_id);
```

## Multi-Model Consensus

```typescript
const result = await aira.runCase(
  "Should we approve loan #4521?",
  ["claude-sonnet-4-6", "gpt-4o", "gemini-2.0-flash"],
);

console.log(result.consensus.decision);     // "APPROVE"
console.log(result.consensus.confidence);   // 0.92
```

## Evidence Packages

```typescript
const pkg = await aira.createEvidencePackage({
  title: "Q1 2026 Lending Audit",
  actionIds: [decision.action_id, email.action_id],
  description: "All lending decisions for regulatory review",
});

console.log(pkg.package_hash);  // sha256:...
console.log(pkg.signature);    // ed25519:...
```

## Agent Will & Estate

```typescript
await aira.setAgentWill("lending-agent", {
  successorSlug: "lending-agent-v2",
  successionPolicy: "transfer_to_successor",
  dataRetentionDays: 2555,
  notifyEmails: ["compliance@acme.com"],
});

await aira.createComplianceSnapshot({
  framework: "eu-ai-act",
  agentSlug: "lending-agent",
  findings: { art_12_logging: "pass", art_14_oversight: "pass" },
});
```

## Escrow (Liability Commitments)

Escrow accounts are **accountability ledgers** — they record liability commitments with cryptographic proof. No real funds are custodied by Aira.

```typescript
const account = await aira.createEscrowAccount({ purpose: "Loan liability" });
await aira.escrowDeposit(account.id, 15000, "Liability commitment for loan #4521");
await aira.escrowRelease(account.id, 15000, "Loan disbursed successfully");
```

## Chat

```typescript
const response = await aira.ask("How many loan decisions were notarized this week?", {
  model: "claude-sonnet-4-6",
});
console.log(response.content);
```

The `model` parameter is optional. If omitted, the organization's default chat model is used.

> A default chat model must be configured in your dashboard (Settings → Models) before using `ask()` without an explicit model.

## Public Verification

```typescript
// No auth needed — anyone can verify
const result = await aira.verifyAction("action-uuid");
console.log(result.valid);    // true
console.log(result.message);  // "Action receipt exists..."
```

## Error Handling

```typescript
import { Aira, AiraError } from "aira-sdk";

try {
  await aira.notarize({ actionType: "test", details: "test" });
} catch (e) {
  if (e instanceof AiraError) {
    console.log(e.status);   // 429
    console.log(e.code);     // "PLAN_LIMIT_EXCEEDED"
    console.log(e.message);  // "Monthly operation limit reached"
  }
}
```

## Configuration

```typescript
const aira = new Aira({
  apiKey: "aira_live_xxx",
  baseUrl: "https://your-self-hosted.com",  // Self-hosted
  timeout: 60_000,                           // Request timeout in ms
});
```

## License

MIT

## Links

- [Interactive Demo](https://app.airaproof.com/demo) — try Aira in your browser, no code needed
- [Documentation](https://docs.airaproof.com)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [Python SDK](https://pypi.org/project/aira-sdk/)
- [Dashboard](https://app.airaproof.com)
