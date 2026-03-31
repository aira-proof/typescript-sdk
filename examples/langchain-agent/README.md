# LangChain.js + Aira — Auto-Notarization

Demonstrates `AiraCallbackHandler`, which hooks into LangChain's callback system to notarize tool calls, chain completions, and LLM generations with cryptographic receipts.

## What It Does

| Event | Action Type | What Gets Notarized |
|-------|-------------|---------------------|
| Tool finishes | `tool_call` | Tool name + output length |
| Chain finishes | `chain_completed` | Output keys |
| LLM finishes | `llm_completion` | Generation count |

Each notarization creates a tamper-proof receipt with an Ed25519 signature.

## Setup

```bash
npm install aira-sdk
export AIRA_API_KEY="aira_live_xxx"    # https://app.airaproof.com/dashboard/api-keys
npx tsx examples/langchain-agent/index.ts
```

## Usage in a Real LangChain App

```typescript
import { Aira } from "aira-sdk";
import { AiraCallbackHandler } from "aira-sdk/extras/langchain";

const aira = new Aira({ apiKey: process.env.AIRA_API_KEY! });
const handler = new AiraCallbackHandler(aira, "my-agent", { modelId: "gpt-4o" });

// Pass to any LangChain chain or agent:
const result = await myChain.invoke(input, {
  callbacks: [handler.asCallbacks()],
});
```

## Output

```
============================================================
  Aira + LangChain.js — Notarization Demo
============================================================

1. Tool call: search_docs
----------------------------------------
   Notarized: tool_call for 'search_docs'

2. Chain completion
----------------------------------------
   Notarized: chain_completed with output keys [output, sources]

3. LLM generation
----------------------------------------
   Notarized: llm_completion with 2 generations

4. Verify audit trail
----------------------------------------
   Total notarized actions: 3
   Latest action: llm_completion
   Valid: true
   Signature key: aira-signing-key-v1
   Receipt: Action receipt exists and signing key is valid...

============================================================
  Done — 3 actions notarized with cryptographic receipts
============================================================
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [LangChain.js](https://js.langchain.com/)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
