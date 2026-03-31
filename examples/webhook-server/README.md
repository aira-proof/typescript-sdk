# Aira Webhook Server — Signature Verification + Event Routing

An Express server that receives Aira webhook events with HMAC-SHA256 signature verification and routes them to typed handlers.

## Supported Events

| Event | Description |
|-------|-------------|
| `action.notarized` | New cryptographic receipt created |
| `action.authorized` | Action authorized by human reviewer |
| `case.complete` | Multi-model consensus finished |
| `case.requires_human_review` | Models disagreed, needs human input |
| `evidence.sealed` | Evidence package sealed with hash |
| `escrow.deposited` | Escrow funds committed |
| `escrow.released` | Escrow funds released |
| `escrow.disputed` | Escrow dispute filed |
| `compliance.snapshot_created` | New compliance snapshot |
| `agent.registered` | Agent registered in the registry |
| `agent.decommissioned` | Agent decommissioned |

## Setup

```bash
npm install aira-sdk express
npm install -D @types/express tsx
export AIRA_WEBHOOK_SECRET="whsec_xxx"   # https://app.airaproof.com/dashboard/webhooks
npx tsx examples/webhook-server/index.ts
```

## Testing Locally

Use a tunnel (ngrok, Cloudflare Tunnel) to expose your local server:

```bash
# Terminal 1: Start the server
npx tsx examples/webhook-server/index.ts

# Terminal 2: Expose with ngrok
ngrok http 5000

# Then set the ngrok URL as your webhook endpoint in the Aira dashboard:
# https://app.airaproof.com/dashboard/webhooks
# -> https://abc123.ngrok.io/webhook
```

Or test with curl:

```bash
# Generate a test signature
SECRET="whsec_xxx"
PAYLOAD='{"event":"action.notarized","data":{"action_id":"act_123","action_type":"test"}}'
SIG="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)"

curl -X POST http://localhost:5000/webhook \
  -H "Content-Type: application/json" \
  -H "x-aira-signature: $SIG" \
  -d "$PAYLOAD"
```

## Security Notes

- Always use `express.raw()` (not `express.json()`) for the webhook route to preserve the exact bytes for signature verification.
- The `verifySignature` function uses constant-time comparison (`timingSafeEqual`) to prevent timing attacks.
- Respond with 200 quickly — Aira retries on non-2xx responses with exponential backoff.

## Output

```
============================================================
  Aira Webhook Server
============================================================
  Listening:  http://localhost:5000/webhook
  Health:     http://localhost:5000/health
  Secret:     whsec_xxx...

  Supported events:
    - case.complete (CASE_COMPLETE)
    - case.requires_human_review (CASE_REQUIRES_REVIEW)
    - action.notarized (ACTION_NOTARIZED)
    ...

  Waiting for events...

  Received: action.notarized
  Delivery: dlv_01J8X...
  Time:     2026-03-31T12:00:00Z
  -> Action notarized: act_01J8X...
     Type: loan_decision, Agent: lending-agent
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [Webhook Guide](https://docs.airaproof.com/docs/webhooks)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
