# Aira TypeScript SDK — The authorization and audit layer for AI agents.

[![npm version](https://img.shields.io/npm/v/aira-sdk.svg)](https://www.npmjs.com/package/aira-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Drop Aira into your agent stack in one line. Define policies without changing code. Get cryptographic proof of every decision — for your auditors, your board, or a court. Not because regulation requires it. Because your agents are acting in production right now.

```bash
npm install aira-sdk
```

Framework integrations use sub-imports — just make sure the peer dependency is installed:

```bash
npm install aira-sdk langchain      # for LangChain.js
npm install aira-sdk ai             # for Vercel AI
npm install aira-sdk @openai/agents # for OpenAI Agents
```

---

## Quick Start

Aira uses a **two-step flow**: `authorize()` BEFORE the action runs,
`notarize()` AFTER. This lets you block disallowed actions before they have
any real-world effect, and still produce a cryptographic receipt once the
action has completed.

```typescript
import { Aira, AiraError } from "aira-sdk";

const aira = new Aira({ apiKey: "aira_live_xxx" });

try {
  // Step 1 — ask Aira whether the action is allowed.
  const auth = await aira.authorize({
    actionType: "wire_transfer",
    details: "Send €75K to vendor X",
    agentId: "payments-agent",
  });

  if (auth.status === "authorized") {
    // Step 2a — execute the action, then notarize the outcome.
    const result = await sendWire(75_000, "vendor");
    await aira.notarize({
      actionId: auth.action_id,
      outcome: "completed",
      outcomeDetails: `Sent. ref=${result.id}`,
    });
  } else if (auth.status === "pending_approval") {
    // Step 2b — enqueue for the approver flow; do NOT execute.
    await queue.enqueue(auth.action_id);
  }
} catch (e) {
  // Step 2c — a policy denied the action. Nothing to execute, nothing to
  // notarize. POLICY_DENIED is thrown, never returned as a status.
  if (e instanceof AiraError && e.code === "POLICY_DENIED") {
    console.log(`Blocked: ${e.message}`);
  } else {
    throw e;
  }
}
```

The returned `ActionReceipt` carries the Ed25519 signature and RFC 3161
timestamp token. If you pass `outcome: "failed"`, the backend still writes
an audit entry but leaves `signature` / `receipt_id` null.

---

## Core SDK Methods

All 52 methods on `Aira`. Every write operation produces a cryptographic receipt.

| Category | Method | Description |
|---|---|---|
| **Actions** | `authorize()` | Step 1 — authorize an action BEFORE it runs (throws POLICY_DENIED) |
| | `notarize()` | Step 2 — notarize the outcome, returns Ed25519-signed receipt |
| | `getAction()` | Retrieve action details + receipt |
| | `listActions()` | List actions with filters (type, agent, status) |
| | `cosign()` | Human co-signature on a high-stakes action |
| | `setLegalHold()` | Prevent deletion -- litigation hold |
| | `releaseLegalHold()` | Release litigation hold |
| | `getActionChain()` | Chain of custody for an action |
| | `verifyAction()` | Public verification -- no auth required |
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
| | `escrowDispute()` | Dispute -- flag liability issue |
| **Chat** | `ask()` | Query your notarized data via AI |
| **Offline** | `sync()` | Flush offline queue to API |
| **Session** | `session()` | Scoped session with pre-filled defaults |

---

## Trust Layer

Standards-based identity and trust for agents: W3C DIDs, Verifiable Credentials, mutual notarization, and reputation scoring. Every agent gets a cryptographically verifiable identity that other agents (and humans) can check before interacting.

### DID Identity

Every registered agent gets a W3C-compliant DID (`did:web`):

```typescript
// Retrieve the agent's DID
const did = await aira.getAgentDid("my-agent");
console.log(did);  // "did:web:airaproof.com:agents:my-agent"

// Rotate signing keys (old keys are revoked, new keys are published)
await aira.rotateAgentKeys("my-agent");
```

### Verifiable Credentials

```typescript
// Get the agent's W3C Verifiable Credential
const vc = await aira.getAgentCredential("my-agent");

// Verify any VC (returns validity, issuer, expiry)
const result = await aira.verifyCredential(vc);
console.log(result.valid);  // true

// Revoke a credential
await aira.revokeCredential("my-agent", { reason: "Agent deprecated" });
```

### Mutual Notarization

For high-stakes actions, both parties co-sign:

```typescript
// Agent A initiates — sends a signing request to the counterparty
const request = await aira.requestMutualSign({
  actionId: "act-uuid",
  counterpartyDid: "did:web:partner.com:agents:their-agent",
});

// Agent B completes — signs the same payload
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

Control which external APIs your agents can call. When `endpointUrl` is
passed to `authorize()`, Aira checks it against your org's whitelist
before returning. Unrecognized endpoints throw `ENDPOINT_NOT_WHITELISTED`
in strict mode — the action is never authorized and you never need to
call `notarize()`.

```typescript
import { Aira, AiraError } from "aira-sdk";

try {
  const auth = await aira.authorize({
    actionType: "api_call",
    details: "Charged customer $49.99 for subscription renewal",
    agentId: "billing-agent",
    modelId: "claude-sonnet-4-6",
    endpointUrl: "https://api.stripe.com/v1/charges",
  });

  if (auth.status === "authorized") {
    const result = await stripe.charges.create({ amount: 4999, /* ... */ });
    await aira.notarize({
      actionId: auth.action_id,
      outcome: "completed",
      outcomeDetails: `Charged ${result.id}`,
    });
  }
} catch (e) {
  if (e instanceof AiraError && e.code === "ENDPOINT_NOT_WHITELISTED") {
    console.log(`Blocked: ${e.message}`);
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
    blockUnregistered: false,    // don't block agents without Aira DIDs
  },
});
```

---

## Session

Pre-fill defaults for a block of related actions. Every `authorize()` call
within the session inherits the agent identity, producing receipts that
share a common provenance chain.

```typescript
const sess = aira.session("onboarding-agent", { modelId: "claude-sonnet-4-6" });

async function notarize(actionType: string, details: string) {
  const auth = await sess.authorize({ actionType, details });
  if (auth.status === "authorized") {
    await sess.notarize({ actionId: auth.action_id, outcome: "completed" });
  }
}

await notarize("identity_verified", "Verified customer ID #4521");
await notarize("account_created", "Created account for customer #4521");
await notarize("welcome_sent", "Sent welcome email to customer #4521");
```

---

## Offline Mode

Queue `authorize()` calls locally when connectivity is unavailable. On
`sync()`, the backend runs the real authorizations and returns their
results. The agent can then call `notarize()` per action to close the loop.

```typescript
const aira = new Aira({ apiKey: "aira_live_xxx", offline: true });

// These queue locally — no network calls
await aira.authorize({ actionType: "scan_completed", details: "Scanned document batch #77" });
await aira.authorize({ actionType: "classification_done", details: "Classified 142 documents" });

console.log(aira.pendingCount);  // 2

// Flush to the API when back online — returns the Authorization for each
// queued request. Use the action_ids to notarize outcomes afterwards.
const results = await aira.sync();
```

Offline mode is intended for actions the agent will execute regardless of
Aira's decision (sensor reads, local scans). For actions whose execution
depends on the authorization result, run the SDK online.

---

## Human Approval

Hold high-stakes actions for human review before they execute. Approvers
receive an email with Approve/Deny buttons. If the action is held, the SDK
returns `status: "pending_approval"` from `authorize()` and the agent must
enqueue the `action_id` instead of executing.

```typescript
const auth = await aira.authorize({
  actionType: "loan_decision",
  details: "Approve €15,000 loan for Maria Schmidt",
  agentId: "lending-agent",
  requireApproval: true,
  approvers: ["compliance@acme.com", "risk@acme.com"],
});

if (auth.status === "pending_approval") {
  // Do NOT execute the action. Store action_id and wait for the
  // action.approved webhook, then execute + notarize.
  await queue.enqueue(auth.action_id);
}
```

The approver clicks "Approve" in the email → the action transitions to
`authorized` → `action.approved` webhook fires → your handler executes the
action and calls `aira.notarize({ actionId, outcome: "completed" })`.

Configure default approvers in the [dashboard](https://app.airaproof.com/dashboard/settings/approvers).

### Automatic Policy Evaluation

Org admins configure policies in the dashboard — your code doesn't change.
Every `authorize()` call is automatically evaluated against active policies
before returning. If a policy denies the action, the SDK throws
`AiraError` with code `POLICY_DENIED` and the action is never persisted as
authorized. If a policy forces human review, `status` is
`pending_approval`. Otherwise `status` is `authorized`.

Three evaluation modes:

- **Rules**: Deterministic conditions — instant, no LLM call
- **AI**: Single LLM evaluates action against a natural language policy (1-5s)
- **Consensus**: Multiple LLMs evaluate independently — disagreement triggers human review (3-10s)

```typescript
import { AiraError } from "aira-sdk";

try {
  const auth = await aira.authorize({
    actionType: "data_deletion",
    details: "Delete customer records",
    agentId: "support-agent",
  });
  // ... execute + notarize ...
} catch (e) {
  if (e instanceof AiraError && e.code === "POLICY_DENIED") {
    console.log(e.message);  // "Action denied by policy 'Block deletions': ..."
  }
}
```

Configure policies at [Settings → Policies](https://app.airaproof.com/dashboard/policies).

---

## Framework Integrations

Drop Aira into your existing agent framework with one import. Every integration is honestly labeled as one of three kinds:

- **gate** — intercepts before execution and can deny. The action is authorized through Aira's policy engine *before* the framework runs the underlying call. Denied actions never run.
- **audit** — runs after execution because the host framework does not expose a pre-execution hook that can abort. Aira still records a signed receipt; it just cannot prevent the action.
- **adapter** — exposes Aira's own API as a tool the host framework can call. Neither a gate nor an audit hook over other tools.

We ship fewer integrations than some competitors and label every one of them honestly. The integration matrix is generated from `INTEGRATIONS` in `aira-sdk/extras` — the docs cannot drift from the code.

| Integration | Import | Type | Pre-execution gate? | Surface | Notes |
|---|---|---|---|---|---|
| **LangChain.js** | `aira-sdk/extras/langchain` | gate | Yes (tools); No (chains/LLMs) | `AiraCallbackHandler` | `handleToolStart` calls `authorize()` and throws on `POLICY_DENIED` so the tool never runs. Chain/LLM hooks are post-hoc because LangChain has no pre-execution chain hook that can abort. |
| **Vercel AI SDK** | `aira-sdk/extras/vercel-ai` | gate | Yes (`wrapTool`); No (`onFinish`) | `AiraVercelMiddleware` | `wrapTool()` wraps the tool's `execute` so `authorize()` runs before the tool body. `onStepFinish` / `onFinish` callbacks are explicitly labeled audit-only. |
| **OpenAI Agents** | `aira-sdk/extras/openai-agents` | gate | Yes | `AiraGuardrail.wrapTool()` | Wraps each tool function: `authorize()` runs before the tool body. Denied calls throw; failed calls notarize with `outcome="failed"`. |
| **MCP** | `aira-sdk/extras/mcp` | adapter | N/A | `createServer()` | MCP is bidirectional: the agent CHOOSES to call `authorize_action` / `notarize_action`. Not a wrapper over other MCP tools — it's a protocol adapter. |
| **Webhooks** | `aira-sdk/extras/webhooks` | adapter | N/A | `verifySignature()` | Standalone HMAC-SHA256 webhook signature verifier. Not an agent integration. |

### LangChain.js

`AiraCallbackHandler` runs the two-step flow on every tool, chain, and LLM
event. The `Start` callbacks call `authorize()` — if a policy denies the
action or flags it for human review, LangChain aborts the step. The `End`
and `Error` callbacks call `notarize()` with the appropriate outcome. This
is a **real authorization gate**, not just post-hoc audit logging.

```typescript
import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const handler = new AiraCallbackHandler(aira, "research-agent", {
  modelId: "gpt-5.2",
  strict: false, // fail-open on network errors; set true to fail-closed
});

const result = await chain.invoke(
  { input: "Analyze Q1 revenue" },
  { callbacks: [handler.asCallbacks()] },
);
```

### Vercel AI

`AiraVercelMiddleware` exposes two integration points:

- **`wrapTool()`** — the real authorization gate. Calls `authorize()`
  before the tool runs, notarizes the outcome afterwards. Use this for any
  tool that touches the outside world.
- **`onStepFinish` / `onFinish`** — post-hoc audit callbacks. These fire
  after the step has run and cannot gate execution. Useful for logging
  generation metadata.

```typescript
import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
import { tool } from "ai";
import { z } from "zod";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const middleware = new AiraVercelMiddleware(aira, "assistant-agent");

const webSearch = tool({
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  execute: middleware.wrapTool(async ({ query }) => {
    return await search(query);
  }, "web_search"),
});

const result = await generateText({
  model: openai("gpt-5.2"),
  prompt: "Find today's EU AI Act news",
  tools: { webSearch },
  ...middleware.asCallbacks(),
});
```

### OpenAI Agents SDK

`AiraGuardrail.wrapTool()` gates every tool invocation through Aira's
two-step flow: `authorize()` runs first and can block the tool on
`POLICY_DENIED` or `pending_approval`, then `notarize()` closes the loop
after the tool returns. Only tool names and arg keys are sent — raw user
input stays in your process.

```typescript
import { Aira } from "aira-sdk";
import { AiraGuardrail } from "aira-sdk/extras/openai-agents";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const guardrail = new AiraGuardrail(aira, "assistant-agent");

const search = guardrail.wrapTool(searchTool, "web_search");
const execute = guardrail.wrapTool(codeExecutor, "code_exec");
```

---

## MCP Server

Expose Aira as an MCP tool server. Any MCP-compatible AI agent can run the
two-step flow and verify receipts without a direct SDK dependency.

```typescript
import { Aira } from "aira-sdk";
import { createServer } from "aira-sdk/extras/mcp";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const { listTools, callTool } = createServer(aira);
// Wire into @modelcontextprotocol/sdk's Server.
```

The server exposes the two-step flow as explicit tools:
`authorize_action`, `notarize_action`, `get_action`, `verify_action`,
`get_receipt`, plus trust-layer helpers. An MCP client is expected to call
`authorize_action` before performing a side effect and `notarize_action`
after — the MCP protocol has no hidden hook point, so the authorization
gate only exists if the agent cooperates with the contract.

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

---

## Webhook Verification

Verify that incoming webhooks are authentic Aira events, not forged requests. HMAC-SHA256 signature verification ensures tamper-proof delivery.

```typescript
import { verifySignature, parseEvent } from "aira-sdk/extras/webhooks";

// Verify the webhook signature (HMAC-SHA256)
const isValid = verifySignature({
  payload: request.body,
  signature: request.headers["x-aira-signature"],
  secret: "whsec_xxx",
});

if (isValid) {
  const event = parseEvent(request.body);
  console.log(event.eventType);    // "action.notarized"
  console.log(event.data);         // Action data with cryptographic receipt
  console.log(event.deliveryId);   // Unique delivery ID
}
```

Supported event types: `action.notarized`, `action.authorized`, `agent.registered`, `agent.decommissioned`, `evidence.sealed`, `escrow.deposited`, `escrow.released`, `escrow.disputed`, `compliance.snapshot_created`, `case.complete`, `case.requires_human_review`.

---

## Error Handling

```typescript
import { Aira, AiraError } from "aira-sdk";

try {
  const auth = await aira.authorize({ actionType: "test", details: "test" });
  // ...
} catch (e) {
  if (e instanceof AiraError) {
    console.log(e.status);   // e.g. 403
    console.log(e.code);     // e.g. "POLICY_DENIED"
    console.log(e.message);
  }
}
```

Framework integrations (LangChain.js, Vercel AI, OpenAI Agents) **fail open
by default** on transient errors (network, 5xx) — a warning is logged and
the tool still runs. `POLICY_DENIED` and `pending_approval` always
propagate as thrown errors so disallowed actions are never executed. Pass
`strict: true` to the integration constructor to fail closed on transient
errors too.

---

## Configuration

```typescript
const aira = new Aira({
  apiKey: "aira_live_xxx",                      // Required — aira_live_ or aira_test_ prefix
  baseUrl: "https://your-self-hosted.com",      // Self-hosted deployment
  timeout: 60_000,                              // Request timeout in ms
  offline: true,                                // Queue locally, sync later
});
```

| Env Variable | Description |
|---|---|
| `AIRA_API_KEY` | API key (used by MCP server) |

---

## SDK Parity

| Feature | Python | TypeScript |
|---|---|---|
| Core API (45+ methods) | Yes | Yes |
| Trust Layer (DID, VC, Reputation) | Yes | Yes |
| LangChain | Yes | Yes |
| CrewAI | Yes | -- (Python-only) |
| Vercel AI | -- (JS-only) | Yes |
| OpenAI Agents | Yes | Yes |
| Google ADK | Yes (Python-only) | -- |
| AWS Bedrock | Yes (Python-only) | -- |
| MCP Server | Yes | Yes |
| Webhooks | Yes | Yes |
| CLI | Yes | -- (use Python CLI) |
| Offline Mode | Yes | Yes |
| Session | Yes | Yes |

---

## Links

- [Website](https://airaproof.com)
- [npm Package](https://www.npmjs.com/package/aira-sdk)
- [Python SDK (PyPI)](https://pypi.org/project/aira-sdk/)
- [Documentation](https://docs.airaproof.com)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [Interactive Demo](https://app.airaproof.com/demo) -- try Aira in your browser, no code needed
- [Dashboard](https://app.airaproof.com)
- [GitHub](https://github.com/aira-proof/typescript-sdk)
