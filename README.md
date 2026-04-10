# Aira TypeScript SDK

**The authorization and audit layer for AI agents.**

[![npm version](https://img.shields.io/npm/v/aira-sdk.svg)](https://www.npmjs.com/package/aira-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Aira sits between your agents and the actions they take. Every action is intercepted, evaluated against your policies, and either authorized, held for human approval, or denied. Authorized actions get a cryptographic receipt. Your code stays the same. Your policies live outside the codebase. Your auditors get proof, not logs.

```bash
npm install aira-sdk
```

Framework integrations use sub-imports. Install the matching peer dependency:

```bash
npm install aira-sdk langchain      # for LangChain.js
npm install aira-sdk ai             # for Vercel AI
npm install aira-sdk @openai/agents # for OpenAI Agents
```

---

## Quick Start

Wrap any agent action with `notarize()`. Aira evaluates it against your active policies, holds it for approval if needed, and only mints a cryptographic receipt once the action is authorized.

```typescript
import { Aira } from "aira-sdk";

const aira = new Aira({ apiKey: "aira_live_xxx" });

const receipt = await aira.notarize({
  actionType: "email_sent",
  details: "Sent onboarding email to customer@example.com",
  agentId: "support-agent",
  modelId: "claude-sonnet-4-6",
  instructionHash: "sha256:a1b2c3...",
});

console.log(receipt.status);         // "authorized"
console.log(receipt.payload_hash);   // sha256:e5f6a7b8...
console.log(receipt.signature);      // ed25519:base64url...
console.log(receipt.action_id);      // uuid, publicly verifiable
```

What just happened, in order:

1. Aira intercepted the call.
2. Active policies were evaluated against the action.
3. The action was authorized (or held, or denied).
4. A receipt was minted with an Ed25519 signature and an RFC 3161 timestamp.

If a policy required human approval, `receipt.status` would be `"pending_approval"` and `receipt_id` would be undefined until an approver clicks Approve. If a policy denied the action, `notarize()` would throw an `AiraError` with code `POLICY_DENIED`.

---

## Policy Engine

Policies are configured in the dashboard, not in code. Every `notarize()` call is automatically evaluated against active policies before the receipt is issued. There are three evaluation modes.

### Rules mode

Deterministic conditions over action fields. Instant, no LLM call.

Example policy: "If `actionType` is `wire_transfer` and amount is greater than $10,000, require approval from compliance."

```typescript
// Your code stays the same. The policy fires automatically.
const receipt = await aira.notarize({
  actionType: "wire_transfer",
  details: "Transfer $50,000 to vendor account",
  agentId: "billing-agent",
});

console.log(receipt.status);             // "pending_approval"
console.log(receipt.policy_evaluation);  // { policy_name: "Wire transfers over $10k", decision: "require_approval", ... }
```

### AI mode

A single LLM evaluates the action against a natural language policy. Latency is roughly 1 to 5 seconds.

Example policy: "Block any customer communication that promises a refund without a manager sign-off."

```typescript
import { AiraError } from "aira-sdk";

try {
  await aira.notarize({
    actionType: "email_sent",
    details: "Promised full refund of $2,400 to angry customer",
    agentId: "support-agent",
  });
} catch (e) {
  if (e instanceof AiraError && e.code === "POLICY_DENIED") {
    console.log(e.message);  // "Action denied by policy 'No refund promises': ..."
  }
}
```

### Consensus mode

Multiple LLMs evaluate the action independently. If they disagree, the action is escalated to human review. Latency is roughly 3 to 10 seconds.

This is the strongest mode for high-stakes decisions where a single model might hallucinate or be jailbroken.

```typescript
const receipt = await aira.notarize({
  actionType: "loan_decision",
  details: "Approved €15,000 loan for Maria Schmidt",
  agentId: "lending-agent",
});

// If models agreed: receipt.status === "authorized"
// If models disagreed: receipt.status === "pending_approval"
console.log(receipt.policy_evaluation);
```

You can also run consensus directly outside the policy engine for ad-hoc adjudication:

```typescript
const result = await aira.runCase(
  "Should we approve this €15,000 loan for Maria Schmidt?",
  ["claude-sonnet-4-6", "gpt-5.2", "gemini-2.5-pro"],
);
```

Every policy evaluation produces its own cryptographic receipt. You have proof the policy was checked, what it decided, and why. Configure policies at [Settings, Policies](https://app.airaproof.com/dashboard/policies).

---

## Human Approval

Bypass the policy engine and force human approval inline by passing `requireApproval: true`. Approvers receive an email with Approve and Deny buttons.

```typescript
const receipt = await aira.notarize({
  actionType: "loan_decision",
  details: "Approved €15,000 loan for Maria Schmidt",
  agentId: "lending-agent",
  requireApproval: true,
  approvers: ["compliance@acme.com", "risk@acme.com"],
});

console.log(receipt.status);      // "pending_approval"
console.log(receipt.receipt_id);  // undefined, no receipt until approved
```

If you omit `approvers`, Aira falls back to your org's default approver list:

```typescript
const receipt = await aira.notarize({
  actionType: "wire_transfer",
  details: "Transfer $50,000 to vendor account",
  agentId: "payments-agent",
  requireApproval: true,
});
```

When the approver clicks Approve, the receipt is minted with an Ed25519 signature and an RFC 3161 timestamp, and an `action.approved` webhook fires. Configure default approvers in the [dashboard](https://app.airaproof.com/dashboard/settings/approvers).

---

## Verification

Receipts are publicly verifiable. Anyone can confirm an action was authorized and not tampered with, no API key required.

```typescript
const result = await aira.verifyAction("act-uuid");
console.log(result.valid);  // true
```

Use this to share proof with auditors, regulators, customers, or in court.

---

## Framework Integrations

Drop Aira into your existing agent framework with one import. Every framework integration runs the same policy engine, the same approval flow, and produces the same cryptographic receipts.

| Framework | Import | Integration |
|---|---|---|
| **LangChain.js** | `import { AiraCallbackHandler } from "aira-sdk/extras/langchain"` | Callback handler |
| **Vercel AI** | `import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai"` | Middleware |
| **OpenAI Agents** | `import { AiraGuardrail } from "aira-sdk/extras/openai-agents"` | Guardrail |
| **MCP** | `import { createServer } from "aira-sdk/extras/mcp"` | MCP Server |
| **Webhooks** | `import { verifySignature } from "aira-sdk/extras/webhooks"` | Verification |

### LangChain.js

`AiraCallbackHandler` runs every tool call, chain completion, and LLM invocation through the policy engine and produces a cryptographic receipt. No changes to your chain logic.

```typescript
import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const handler = new AiraCallbackHandler({ client: aira, agentId: "research-agent", modelId: "gpt-5.2" });

const result = await chain.invoke({ input: "Analyze Q1 revenue" }, { callbacks: [handler] });
```

### Vercel AI

`AiraVercelMiddleware` wraps your Vercel AI `streamText` and `generateText` calls so every model invocation is policy-checked and notarized.

```typescript
import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const middleware = new AiraVercelMiddleware({ client: aira, agentId: "assistant-agent" });

const result = await middleware.wrapGenerateText({
  model: openai("gpt-5.2"),
  prompt: "Summarize the contract terms",
});
```

### OpenAI Agents SDK

`AiraGuardrail` wraps any tool function so both invocation and result run through the policy engine.

```typescript
import { Aira } from "aira-sdk";
import { AiraGuardrail } from "aira-sdk/extras/openai-agents";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const guardrail = new AiraGuardrail({ client: aira, agentId: "assistant-agent" });

const search = guardrail.wrapTool(searchTool, { toolName: "web_search" });
const execute = guardrail.wrapTool(codeExecutor, { toolName: "code_exec" });
```

### MCP Server

Expose Aira as an MCP tool server. Any MCP-compatible AI agent can authorize actions and verify receipts without an SDK integration.

```typescript
import { createServer } from "aira-sdk/extras/mcp";

const server = createServer({ apiKey: "aira_live_xxx" });
server.listen(); // stdio transport
```

The server exposes three tools: `notarize_action`, `verify_action`, and `get_receipt`. Each call runs through the policy engine and produces cryptographically signed results.

Add to your MCP client config:

```json
{
  "mcpServers": {
    "aira": {
      "command": "npx",
      "args": ["aira-sdk", "mcp"],
      "env": { "AIRA_API_KEY": "aira_live_xxx" }
    }
  }
}
```

### Webhooks

Verify that incoming webhooks are authentic Aira events. HMAC-SHA256 signature verification ensures tamper-proof delivery.

```typescript
import { verifySignature, parseEvent } from "aira-sdk/extras/webhooks";

const isValid = verifySignature({
  payload: request.body,
  signature: request.headers["x-aira-signature"],
  secret: "whsec_xxx",
});

if (isValid) {
  const event = parseEvent(request.body);
  console.log(event.eventType);    // "action.notarized"
  console.log(event.data);
  console.log(event.deliveryId);
}
```

Supported event types: `action.notarized`, `action.authorized`, `agent.registered`, `agent.decommissioned`, `evidence.sealed`, `escrow.deposited`, `escrow.released`, `escrow.disputed`, `compliance.snapshot_created`, `case.complete`, `case.requires_human_review`.

---

## Trust Layer

Standards-based identity for agents. W3C DIDs, Verifiable Credentials, mutual notarization, and reputation scoring. Use these to check counterparties before your agents interact with them.

### DID Identity

Every registered agent gets a W3C-compliant DID (`did:web`):

```typescript
const did = await aira.getAgentDid("my-agent");
console.log(did);  // "did:web:airaproof.com:agents:my-agent"

// Rotate signing keys. Old keys are revoked, new keys are published.
await aira.rotateAgentKeys("my-agent");
```

### Verifiable Credentials

```typescript
const vc = await aira.getAgentCredential("my-agent");

const result = await aira.verifyCredential(vc);
console.log(result.valid);  // true

await aira.revokeCredential("my-agent", { reason: "Agent deprecated" });
```

### Mutual Notarization

For high-stakes actions, both parties co-sign:

```typescript
// Agent A initiates and sends a signing request to the counterparty.
const request = await aira.requestMutualSign({
  actionId: "act-uuid",
  counterpartyDid: "did:web:partner.com:agents:their-agent",
});

// Agent B completes by signing the same payload.
const receipt = await aira.completeMutualSign({
  actionId: "act-uuid",
  did: "did:web:partner.com:agents:their-agent",
  signature: "z...",
  signedPayloadHash: "sha256:...",
});
```

### Reputation

```typescript
const rep = await aira.getReputation("my-agent");
console.log(rep.score);  // 84
console.log(rep.tier);   // "Verified"
```

### Endpoint Verification

Control which external APIs your agents can call. When `endpointUrl` is passed to `notarize()`, Aira checks it against your org's whitelist. Unrecognized endpoints are blocked in strict mode.

```typescript
const receipt = await aira.notarize({
  actionType: "api_call",
  details: "Charged customer $49.99 for subscription renewal",
  agentId: "billing-agent",
  modelId: "claude-sonnet-4-6",
  endpointUrl: "https://api.stripe.com/v1/charges",
});
```

Handle a blocked endpoint:

```typescript
import { Aira, AiraError } from "aira-sdk";

try {
  const receipt = await aira.notarize({
    actionType: "api_call",
    details: "Send SMS via new provider",
    agentId: "notifications-agent",
    endpointUrl: "https://api.newprovider.com/v1/sms",
  });
} catch (e) {
  if (e instanceof AiraError && e.code === "ENDPOINT_NOT_WHITELISTED") {
    console.log(`Blocked: ${e.message}`);
    console.log(`Approval request: ${e.details.approval_id}`);
    console.log(`Suggested pattern: ${e.details.url_pattern_suggested}`);
  } else {
    throw e;
  }
}
```

### Trust Policy in Integrations

Pass a `trustPolicy` to any framework integration to run automated trust checks before agent interactions:

```typescript
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const handler = new AiraCallbackHandler(aira, "research-agent", {
  modelId: "gpt-5.2",
  trustPolicy: {
    verifyCounterparty: true,    // resolve counterparty DID
    minReputation: 60,           // warn if reputation score below 60
    requireValidVc: true,        // check Verifiable Credential validity
    blockRevokedVc: true,        // block if counterparty VC is revoked
    blockUnregistered: false,    // do not block agents without Aira DIDs
  },
});
```

---

## Session

Pre-fill defaults for a block of related actions. Every `notarize()` call within the session inherits the agent identity, producing receipts that share a common provenance chain.

```typescript
const sess = aira.session("onboarding-agent", { modelId: "claude-sonnet-4-6" });

await sess.notarize({ actionType: "identity_verified", details: "Verified customer ID #4521" });
await sess.notarize({ actionType: "account_created", details: "Created account for customer #4521" });
await sess.notarize({ actionType: "welcome_sent", details: "Sent welcome email to customer #4521" });
```

---

## Offline Mode

Queue actions locally when connectivity is unavailable. Policy evaluation and receipt minting happen server-side when you sync, so nothing is lost.

```typescript
const aira = new Aira({ apiKey: "aira_live_xxx", offline: true });

// These queue locally with no network calls.
await aira.notarize({ actionType: "scan_completed", details: "Scanned document batch #77" });
await aira.notarize({ actionType: "classification_done", details: "Classified 142 documents" });

console.log(aira.pendingCount);  // 2

// Flush to API when back online. Each action is policy-checked and a receipt is generated.
const results = await aira.sync();
```

---

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

Common error codes:

- `POLICY_DENIED`: An active policy denied the action.
- `ENDPOINT_NOT_WHITELISTED`: The target endpoint is not in your whitelist.
- `PLAN_LIMIT_EXCEEDED`: Monthly operation limit reached.

All framework integrations (LangChain.js, Vercel AI, OpenAI Agents) are non-blocking by default. Notarization failures are logged, never raised. Your agent keeps running.

---

## Configuration

```typescript
const aira = new Aira({
  apiKey: "aira_live_xxx",                      // Required, aira_live_ or aira_test_ prefix
  baseUrl: "https://your-self-hosted.com",      // Self-hosted deployment
  timeout: 60_000,                              // Request timeout in ms
  offline: true,                                // Queue locally, sync later
});
```

| Env Variable | Description |
|---|---|
| `AIRA_API_KEY` | API key (used by MCP server) |

### Self-hosting

Aira can run entirely inside your own infrastructure. Point `baseUrl` at your self-hosted deployment and the SDK behaves identically. Policies, receipts, and approval flows all stay within your network. See the [self-hosting docs](https://docs.airaproof.com/docs/self-hosting) for details.

---

## Core SDK Methods

All 52 methods on `Aira`. Every write operation runs through the policy engine and produces a cryptographic receipt when authorized.

| Category | Method | Description |
|---|---|---|
| **Actions** | `notarize()` | Authorize and notarize an action. Returns Ed25519-signed receipt. Supports `requireApproval`. |
| | `getAction()` | Retrieve action details and receipt |
| | `listActions()` | List actions with filters (type, agent, status) |
| | `authorizeAction()` | Human co-signature on a high-stakes action |
| | `setLegalHold()` | Prevent deletion, litigation hold |
| | `releaseLegalHold()` | Release litigation hold |
| | `getActionChain()` | Chain of custody for an action |
| | `verifyAction()` | Public verification, no auth required |
| **Agents** | `registerAgent()` | Register verifiable agent identity |
| | `getAgent()` | Retrieve agent profile |
| | `listAgents()` | List registered agents |
| | `updateAgent()` | Update agent metadata |
| | `publishVersion()` | Publish versioned agent config |
| | `listVersions()` | List agent versions |
| | `decommissionAgent()` | Decommission agent |
| | `transferAgent()` | Transfer ownership to another org |
| | `getAgentActions()` | List actions by agent |
| **Trust Layer** | `getAgentDid()` | Retrieve agent's W3C DID (`did:web`) |
| | `rotateAgentKeys()` | Rotate agent's Ed25519 signing keys |
| | `getAgentCredential()` | Get agent's W3C Verifiable Credential |
| | `verifyCredential()` | Verify a Verifiable Credential |
| | `revokeCredential()` | Revoke agent's Verifiable Credential |
| | `requestMutualSign()` | Initiate mutual notarization with counterparty |
| | `completeMutualSign()` | Complete mutual notarization (counterparty signs) |
| | `getReputation()` | Get agent reputation score and tier |
| | `listReputationHistory()` | List reputation score history |
| | `resolveDid()` | Resolve any DID to its DID Document |
| **Cases** | `runCase()` | Multi-model consensus adjudication |
| | `getCase()` | Retrieve case result |
| | `listCases()` | List cases |
| **Receipts** | `getReceipt()` | Retrieve cryptographic receipt |
| | `exportReceipt()` | Export receipt as JSON or PDF |
| **Evidence** | `createEvidencePackage()` | Sealed, tamper-proof evidence bundle |
| | `listEvidencePackages()` | List evidence packages |
| | `getEvidencePackage()` | Retrieve evidence package |
| | `timeTravel()` | Query actions at a point in time |
| | `liabilityChain()` | Walk full liability chain |
| **Estate** | `setAgentWill()` | Define succession plan |
| | `getAgentWill()` | Retrieve agent will |
| | `issueDeathCertificate()` | Decommission with succession trigger |
| | `getDeathCertificate()` | Retrieve death certificate |
| | `createComplianceSnapshot()` | Compliance snapshot (EU AI Act, SR 11-7, GDPR) |
| | `listComplianceSnapshots()` | List snapshots by framework |
| **Escrow** | `createEscrowAccount()` | Create liability commitment ledger |
| | `listEscrowAccounts()` | List escrow accounts |
| | `getEscrowAccount()` | Retrieve escrow account |
| | `escrowDeposit()` | Record liability commitment |
| | `escrowRelease()` | Release commitment after completion |
| | `escrowDispute()` | Dispute, flag liability issue |
| **Chat** | `ask()` | Query your notarized data via AI |
| **Offline** | `sync()` | Flush offline queue to API |
| **Session** | `session()` | Scoped session with pre-filled defaults |

---

## SDK Parity

| Feature | Python | TypeScript |
|---|---|---|
| Core API (45+ methods) | Yes | Yes |
| Trust Layer (DID, VC, Reputation) | Yes | Yes |
| LangChain | Yes | Yes |
| CrewAI | Yes | No (Python only) |
| Vercel AI | No (JS only) | Yes |
| OpenAI Agents | Yes | Yes |
| Google ADK | Yes (Python only) | No |
| AWS Bedrock | Yes (Python only) | No |
| MCP Server | Yes | Yes |
| Webhooks | Yes | Yes |
| CLI | Yes | No (use Python CLI) |
| Offline Mode | Yes | Yes |
| Session | Yes | Yes |

---

## Links

- [Website](https://airaproof.com)
- [npm Package](https://www.npmjs.com/package/aira-sdk)
- [Python SDK (PyPI)](https://pypi.org/project/aira-sdk/)
- [Documentation](https://docs.airaproof.com)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [Interactive Demo](https://app.airaproof.com/demo). Try Aira in your browser, no code needed.
- [Dashboard](https://app.airaproof.com)
- [GitHub](https://github.com/aira-proof/typescript-sdk)
