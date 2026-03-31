# Aira TypeScript SDK

**Legal infrastructure for AI agents.**

[![npm version](https://img.shields.io/npm/v/aira-sdk.svg)](https://www.npmjs.com/package/aira-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Aira produces cryptographic receipts for every action your AI agent takes. Ed25519 signatures and RFC 3161 timestamps create tamper-proof, court-admissible proof of what happened, who authorized it, and which model made the decision. Built for EU AI Act, SR 11-7, and GDPR compliance.

---

## Integration Matrix

Drop Aira into your existing agent framework with one import:

| Framework | Import | Integration |
|---|---|---|
| **LangChain.js** | `import { AiraCallbackHandler } from "aira-sdk/extras/langchain"` | Callback handler |
| **Vercel AI** | `import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai"` | Middleware |
| **OpenAI Agents** | `import { AiraGuardrail } from "aira-sdk/extras/openai-agents"` | Guardrail |
| **MCP** | `import { createServer } from "aira-sdk/extras/mcp"` | MCP Server |
| **Webhooks** | `import { verifySignature } from "aira-sdk/extras/webhooks"` | Verification |

Or install the core SDK alone:

```bash
npm install aira-sdk
```

---

## Quick Start

Every call to `notarize()` returns a cryptographic receipt -- Ed25519-signed, timestamped, tamper-proof.

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

console.log(receipt.payload_hash);   // sha256:e5f6a7b8...
console.log(receipt.signature);       // ed25519:base64url...
console.log(receipt.action_id);       // uuid — publicly verifiable
```

---

## Framework Integrations

### LangChain.js

`AiraCallbackHandler` notarizes every tool call, chain completion, and LLM invocation with a cryptographic receipt. No changes to your chain logic.

```typescript
import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const handler = new AiraCallbackHandler({ client: aira, agentId: "research-agent", modelId: "gpt-4o" });

// Every tool call and chain completion gets a signed receipt
const result = await chain.invoke({ input: "Analyze Q1 revenue" }, { callbacks: [handler] });
```

### Vercel AI

`AiraVercelMiddleware` wraps your Vercel AI `streamText` / `generateText` calls so every model invocation is notarized with a tamper-proof receipt.

```typescript
import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const middleware = new AiraVercelMiddleware({ client: aira, agentId: "assistant-agent" });

// Wrap your Vercel AI calls — receipts at invocation and completion
const result = await middleware.wrapGenerateText({
  model: openai("gpt-4o"),
  prompt: "Summarize the contract terms",
});
```

### OpenAI Agents SDK

`AiraGuardrail` wraps any tool function to automatically notarize both invocation and result with cryptographic proof.

```typescript
import { Aira } from "aira-sdk";
import { AiraGuardrail } from "aira-sdk/extras/openai-agents";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const guardrail = new AiraGuardrail({ client: aira, agentId: "assistant-agent" });

// Wrap tools — every call and result gets a signed receipt
const search = guardrail.wrapTool(searchTool, { toolName: "web_search" });
const execute = guardrail.wrapTool(codeExecutor, { toolName: "code_exec" });
```

---

## MCP Server

Expose Aira as an MCP tool server. Any MCP-compatible AI agent can notarize actions and verify receipts without SDK integration.

```typescript
import { createServer } from "aira-sdk/extras/mcp";

const server = createServer({ apiKey: "aira_live_xxx" });
server.listen(); // stdio transport
```

The server exposes three tools: `notarize_action`, `verify_action`, and `get_receipt` -- each producing cryptographically signed results.

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

Queue notarizations locally when connectivity is unavailable. Cryptographic receipts are generated server-side when you sync -- nothing is lost.

```typescript
const aira = new Aira({ apiKey: "aira_live_xxx", offline: true });

// These queue locally — no network calls
await aira.notarize({ actionType: "scan_completed", details: "Scanned document batch #77" });
await aira.notarize({ actionType: "classification_done", details: "Classified 142 documents" });

console.log(aira.pendingCount);  // 2

// Flush to API when back online — receipts are generated for each action
const results = await aira.sync();
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

## Core SDK Methods

All 40 methods on `Aira`. Every write operation produces a cryptographic receipt.

| Category | Method | Description |
|---|---|---|
| **Actions** | `notarize()` | Notarize an action -- returns Ed25519-signed receipt |
| | `getAction()` | Retrieve action details + receipt |
| | `listActions()` | List actions with filters (type, agent, status) |
| | `authorizeAction()` | Human co-signature on high-stakes action |
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

All framework integrations (LangChain.js, Vercel AI, OpenAI Agents) are non-blocking by default -- notarization failures are logged, never raised. Your agent keeps running.

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
| Core API (40 methods) | Yes | Yes |
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
