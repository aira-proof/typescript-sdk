# Aira TypeScript SDK

The authorization and audit layer for AI agents. Every action authorized before it runs, every outcome signed with Ed25519.

[![npm](https://img.shields.io/npm/v/aira-sdk)](https://www.npmjs.com/package/aira-sdk)
[![License](https://img.shields.io/npm/l/aira-sdk)](LICENSE)

## Install

```bash
npm install aira-sdk
```

---

## Quick start (two options)

### Option A: Gateway (zero code change)

Route your existing OpenAI or Anthropic calls through Aira's gateway. Every request is authorized and logged -- no SDK integration needed.

```typescript
import OpenAI from "openai";
import { gatewayOpenAIConfig } from "aira-sdk/gateway";

const client = new OpenAI({
  ...gatewayOpenAIConfig({ airaApiKey: "aira_live_..." }),
  apiKey: "sk-...",
});
// Use `client` exactly as before -- Aira gates every call.
```

### Option B: SDK integration

Call `authorize()` before the action runs, `notarize()` after. Denied actions never execute.

```typescript
import { Aira, AiraError } from "aira-sdk";

const aira = new Aira({ apiKey: "aira_live_xxx" });

try {
  const auth = await aira.authorize({
    actionType: "wire_transfer",
    details: "Send EUR 75K to vendor X",
    agentId: "payments-agent",
  });

  if (auth.status === "authorized") {
    const result = await sendWire(75_000, "vendor");
    await aira.notarize({
      actionId: auth.action_id,
      outcome: "completed",
      outcomeDetails: `Sent. ref=${result.id}`,
    });
  } else if (auth.status === "pending_approval") {
    await queue.enqueue(auth.action_id); // wait for webhook
  }
} catch (e) {
  if (e instanceof AiraError && e.code === "POLICY_DENIED") {
    console.log(`Blocked: ${e.message}`);
  } else {
    throw e;
  }
}
```

The returned `ActionReceipt` carries the Ed25519 signature and RFC 3161 timestamp token.

---

## Gateway helpers

Route LLM traffic through Aira without touching your agent code. Available from `"aira-sdk/gateway"` or `"aira-sdk"`.

| Helper | Provider |
|---|---|
| `gatewayOpenAIConfig()` | OpenAI, Azure OpenAI, any OpenAI-compatible API |
| `gatewayAnthropicConfig()` | Anthropic |

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { gatewayAnthropicConfig } from "aira-sdk/gateway";

const client = new Anthropic({
  ...gatewayAnthropicConfig({ airaApiKey: "aira_live_..." }),
  apiKey: "sk-ant-...",
});
```

Both helpers accept an optional `gatewayUrl` for self-hosted deployments.

---

## Core API

Every write produces a cryptographic receipt.

| Method | Description |
|---|---|
| `authorize()` | Gate an action BEFORE it runs. Throws `POLICY_DENIED` if denied. |
| `notarize()` | Sign the outcome AFTER execution. Returns Ed25519-signed receipt. |
| `verifyAction()` | Public receipt verification -- no auth required. |
| `getAction()` / `listActions()` | Retrieve action details and history. |
| `cosign()` | Human co-signature on high-stakes actions. |
| `registerAgent()` / `getAgent()` | Verifiable agent identity (W3C DID). |
| `createComplianceBundle()` | Seal regulator-ready evidence for a date range. |
| `computeDriftBaseline()` / `runDriftCheck()` | Behavioral drift detection with KL divergence. |
| `createSettlement()` | Merkle-anchor a batch of receipts. |
| `runCase()` | Multi-model consensus adjudication. |
| `ask()` | Query your notarized data via AI. |

45+ methods total. See the [API reference](https://docs.airaproof.com/docs/api-reference) for the full list.

---

## Framework integrations

Drop Aira into your existing agent framework with one import. Each integration is a sub-import -- just install the peer dependency alongside `aira-sdk`.

| Framework | Import | Type | Pre-execution gate? |
|---|---|---|---|
| **LangChain.js** | `aira-sdk/extras/langchain` | gate | Yes (tools) |
| **Vercel AI SDK** | `aira-sdk/extras/vercel-ai` | gate | Yes (`wrapTool`) |
| **OpenAI Agents** | `aira-sdk/extras/openai-agents` | gate | Yes |
| **MCP** | `aira-sdk/extras/mcp` | adapter | N/A (agent cooperates) |
| **Webhooks** | `aira-sdk/extras/webhooks` | adapter | N/A |

```bash
npm install aira-sdk @langchain/core  # LangChain.js
npm install aira-sdk ai               # Vercel AI SDK
npm install aira-sdk openai            # OpenAI Agents
```

### LangChain.js

```typescript
import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const aira = new Aira({ apiKey: "aira_live_xxx" });
const handler = new AiraCallbackHandler(aira, "research-agent", {
  modelId: "gpt-5.2",
});

const result = await chain.invoke(
  { input: "Analyze Q1 revenue" },
  { callbacks: [handler.asCallbacks()] },
);
```

### Vercel AI SDK

```typescript
import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
import { tool } from "ai";
import { z } from "zod";

const middleware = new AiraVercelMiddleware(
  new Aira({ apiKey: "aira_live_xxx" }),
  "assistant-agent",
);

const webSearch = tool({
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  execute: middleware.wrapTool(async ({ query }) => {
    return await search(query);
  }, "web_search"),
});
```

### OpenAI Agents SDK

```typescript
import { Aira } from "aira-sdk";
import { AiraGuardrail } from "aira-sdk/extras/openai-agents";

const guardrail = new AiraGuardrail(
  new Aira({ apiKey: "aira_live_xxx" }),
  "assistant-agent",
);

const search = guardrail.wrapTool(searchTool, "web_search");
```

### MCP

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

## Features

- **Policy engine** -- rules, AI, or multi-model consensus evaluation on every action
- **Ed25519 signatures** -- every receipt is cryptographically signed
- **RFC 3161 timestamps** -- tamper-proof time evidence
- **Human approval flow** -- hold high-stakes actions for human review
- **Compliance bundles** -- EU AI Act, ISO 42001, SOC 2 evidence packets
- **Drift detection** -- KL divergence scoring against behavioral baselines
- **Merkle settlement** -- periodic anchoring of receipt batches
- **Trust layer** -- W3C DIDs, Verifiable Credentials, mutual notarization, reputation
- **Endpoint verification** -- whitelist which external APIs your agents can call
- **Offline mode** -- queue locally, sync when back online
- **Sessions** -- scoped defaults for related action sequences

---

## Self-hosted

Point the SDK at your own deployment:

```typescript
const aira = new Aira({
  apiKey: "aira_live_xxx",
  baseUrl: "https://aira.your-company.com",
});
```

Gateway helpers also accept a `gatewayUrl` parameter for self-hosted routing.

---

## Links

- [Documentation](https://docs.airaproof.com)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [Gateway Guide](https://docs.airaproof.com/docs/gateway)
- [Dashboard](https://app.airaproof.com)
- [Interactive Demo](https://app.airaproof.com/demo)
- [GitHub](https://github.com/aira-proof/typescript-sdk)
- [Python SDK](https://pypi.org/project/aira-sdk/)
