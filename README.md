# Aira TypeScript SDK

[![npm version](https://img.shields.io/npm/v/aira-sdk.svg)](https://www.npmjs.com/package/aira-sdk)
[![License: MIT](https://img.shields.io/npm/l/aira-sdk)](LICENSE)
[![Node](https://img.shields.io/node/v/aira-sdk)](package.json)

Authorize every AI agent action before it runs. Sign every outcome with Ed25519.

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Core methods](#core-methods)
- [Gateway](#gateway)
- [Framework integrations](#framework-integrations)
  - [LangChain.js](#langchainjs)
  - [Vercel AI SDK](#vercel-ai-sdk)
  - [OpenAI Agents SDK](#openai-agents-sdk)
  - [MCP](#mcp)
- [Content scanning](#content-scanning)
- [Compliance & DORA](#compliance--dora)
- [Self-hosted](#self-hosted)
- [Links](#links)

## Installation

```sh
npm install aira-sdk
```

## Quick start

```typescript
import { Aira, AiraError } from "aira-sdk";

const aira = new Aira({ apiKey: "aira_live_xxx" });

// 1. Authorize before the action runs
const auth = await aira.authorize({
  actionType: "wire_transfer",
  details: "Send EUR 75K to vendor X",
  agentId: "payments-agent",
});

// 2. Execute your business logic
const result = await sendWire(75_000, "vendor");

// 3. Notarize the outcome -- returns an Ed25519-signed receipt
const receipt = await aira.notarize({
  actionId: auth.action_id,
  outcome: "completed",
  outcomeDetails: `Sent. ref=${result.id}`,
});
```

If the policy denies the action, `authorize()` throws an `AiraError` with code `POLICY_DENIED`. Actions requiring human approval return `status: "pending_approval"` -- listen for the webhook or poll `getAction()`.

## Core methods

| Method | Description |
| --- | --- |
| `authorize()` | Gate an action **before** it runs |
| `notarize()` | Sign the outcome **after** execution (Ed25519 + RFC 3161) |
| `verifyAction()` | Verify a receipt -- no auth required |
| `getAction()` / `listActions()` | Retrieve action details and history |
| `cosign()` | Human co-signature on high-stakes actions |
| `registerAgent()` / `getAgent()` | Verifiable agent identity (W3C DID) |
| `createComplianceBundle()` | Regulator-ready evidence for a date range |
| `computeDriftBaseline()` / `runDriftCheck()` | Behavioral drift detection (KL divergence) |
| `createSettlement()` | Merkle-anchor a batch of receipts |
| `runCase()` | Multi-model consensus adjudication |
| `ask()` | Query your notarized data via AI |
| `createComplianceReport()` | Generate a compliance report (EU AI Act, ISO 42001, SOC 2) |
| `createDoraIncident()` | Report a DORA ICT incident |
| `getOutputPolicy()` / `updateOutputPolicy()` | Content-scan policy for notarized outputs |
| `getActionExplanation()` | Human-readable explanation of an action decision |

60+ methods total. See the [API reference](https://docs.airaproof.com/docs/api-reference) for the full list.

## Gateway

Route existing LLM calls through Aira with zero code changes. Every request is authorized and logged automatically.

```typescript
import OpenAI from "openai";
import { gatewayOpenAIConfig } from "aira-sdk/gateway";

const client = new OpenAI({
  ...gatewayOpenAIConfig({ airaApiKey: "aira_live_..." }),
  apiKey: "sk-...",
});
// Use `client` exactly as before -- Aira gates every call
```

Works with OpenAI, Azure OpenAI, and Anthropic:

| Helper | Provider |
| --- | --- |
| `gatewayOpenAIConfig()` | OpenAI, Azure OpenAI, any OpenAI-compatible API |
| `gatewayAnthropicConfig()` | Anthropic |

Both helpers accept a `gatewayUrl` option for [self-hosted](#self-hosted) deployments.

## Framework integrations

Each integration is a sub-import path. Install the peer dependency alongside `aira-sdk`.

| Framework | Import path | Install |
| --- | --- | --- |
| LangChain.js | `aira-sdk/extras/langchain` | `npm i aira-sdk @langchain/core` |
| Vercel AI SDK | `aira-sdk/extras/vercel-ai` | `npm i aira-sdk ai` |
| OpenAI Agents SDK | `aira-sdk/extras/openai-agents` | `npm i aira-sdk openai` |
| MCP | `aira-sdk/extras/mcp` | `npm i aira-sdk @modelcontextprotocol/sdk` |
| Webhooks | `aira-sdk/extras/webhooks` | `npm i aira-sdk` |

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

## Content scanning

Aira can scan content passed to `notarize()` and block or flag policy violations. Configure the org-level policy:

```typescript
const policy = await aira.updateOutputPolicy({
  mode: "block",
  categories: ["pii", "secrets", "malware"],
});

// If outcomeDetails triggers a scan hit, notarize() returns 422
// with code OUTPUT_SCAN_VIOLATION
```

Retrieve the current policy at any time with `getOutputPolicy()`.

## Compliance & DORA

Generate regulator-ready evidence packets and manage ICT incidents under DORA:

```typescript
// Compliance bundle (EU AI Act, ISO 42001, SOC 2)
const bundle = await aira.createComplianceBundle({
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  framework: "eu_ai_act",
});

// DORA incident reporting
const incident = await aira.createDoraIncident({
  title: "API gateway outage",
  description: "Payment processing unavailable for 45 minutes",
  severity: "major",
  detectedAt: new Date().toISOString(),
});

// Compliance report with PDF download
const report = await aira.createComplianceReport({
  framework: "eu_ai_act",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
});
const pdf = await aira.downloadComplianceReport(report.id);
```

Additional DORA methods: `classifyDoraIncident()`, `resolveDoraIncident()`, `createDoraTest()`, `createIctThirdParty()`, and more.

## Self-hosted

Point the SDK at your own deployment:

```typescript
const aira = new Aira({
  apiKey: "aira_live_xxx",
  baseUrl: "https://aira.your-company.com",
});
```

Gateway helpers also accept a `gatewayUrl` parameter:

```typescript
gatewayOpenAIConfig({
  airaApiKey: "aira_live_...",
  gatewayUrl: "https://aira.your-company.com/gateway",
});
```

## Links

- [Documentation](https://docs.airaproof.com)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [Gateway Guide](https://docs.airaproof.com/docs/gateway)
- [Dashboard](https://app.airaproof.com)
- [Interactive Demo](https://app.airaproof.com/demo)
- [GitHub](https://github.com/aira-proof/typescript-sdk)
- [Python SDK](https://pypi.org/project/aira-sdk/)
