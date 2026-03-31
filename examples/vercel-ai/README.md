# Vercel AI SDK + Aira — Auto-Notarization

Demonstrates `AiraVercelMiddleware`, which hooks into the Vercel AI SDK's `streamText`/`generateText` callbacks to notarize tool calls, step completions, and final generations with cryptographic receipts.

## What It Does

| Event | Action Type | What Gets Notarized |
|-------|-------------|---------------------|
| Tool called | `tool_call` | Tool name + argument keys |
| Tool returned | `tool_completed` | Tool name + result length |
| Step finished | `step_completed` | Step type + token count |
| Generation done | `generation_completed` | Finish reason + total tokens |

## Setup

```bash
npm install aira-sdk
export AIRA_API_KEY="aira_live_xxx"    # https://app.airaproof.com/dashboard/api-keys
npx tsx examples/vercel-ai/index.ts
```

## Usage in a Real Vercel AI App

```typescript
import { Aira } from "aira-sdk";
import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
import { streamText } from "ai";

const aira = new Aira({ apiKey: process.env.AIRA_API_KEY! });
const middleware = new AiraVercelMiddleware(aira, "my-agent", { modelId: "gpt-4o" });

// Option 1: Spread callbacks into streamText/generateText
const result = await streamText({
  model: openai("gpt-4o"),
  prompt: "Summarize the document",
  ...middleware.asCallbacks(),
});

// Option 2: Wrap individual tools for automatic notarization
const wrappedSearch = middleware.wrapTool(searchFunction, "web_search");
```

## Output

```
============================================================
  Aira + Vercel AI SDK — Notarization Demo
============================================================

1. Tool call: web_search
----------------------------------------
   Notarized: tool_call for 'web_search'
   Notarized: tool_completed (1250 chars result)

2. Step completion
----------------------------------------
   Notarized: step_completed (tool-result, 340 tokens)
   Notarized: step_completed (text-delta, 128 tokens)

3. Generation completed
----------------------------------------
   Notarized: generation_completed (stop, 468 total tokens)

4. Verify audit trail
----------------------------------------
   Total notarized actions: 5
   Valid: true
   Signature key: aira-signing-key-v1
   Receipt: Action receipt exists and signing key is valid...

============================================================
  Done — 5 actions notarized with cryptographic receipts
============================================================
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
