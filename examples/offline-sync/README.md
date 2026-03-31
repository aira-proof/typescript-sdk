# Aira Offline Mode — Queue & Sync

Demonstrates the SDK's offline mode: queue notarization calls locally without network access, then flush the queue when connectivity is available to get real cryptographic receipts.

## Use Cases

- **Edge/IoT agents** with intermittent connectivity
- **Batch processing** with a single sync at the end
- **Testing** without hitting the API on every call

## How It Works

1. Create client with `offline: true` — all POST requests are queued in memory
2. Call `aira.notarize()` as normal — returns instantly with a placeholder
3. Check `aira.pendingCount` to see how many actions are queued
4. Call `aira.sync()` when online — flushes the queue and returns real receipts

```
notarize() ──> [Queue] ──> [Queue] ──> [Queue]
                                          │
                              sync() ─────┘
                                │
                          ┌─────┴─────┐
                          │  API call │  (for each queued item)
                          └─────┬─────┘
                                │
                          Real receipts with Ed25519 signatures
```

## Setup

```bash
npm install aira-sdk
export AIRA_API_KEY="aira_live_xxx"    # https://app.airaproof.com/dashboard/api-keys
npx tsx examples/offline-sync/index.ts
```

## Output

```
============================================================
  Aira Offline Mode — Queue & Sync Demo
============================================================

1. Queue actions (offline)
----------------------------------------
   Queued: scan_completed (Batch #1)  [offline_a1b2c3d4e5f6]
   Queued: scan_completed (Batch #2)  [offline_g7h8i9j0k1l2]
   Queued: scan_completed (Batch #3)  [offline_m3n4o5p6q7r8]
   Queued: report_generated           [offline_s9t0u1v2w3x4]

   Pending: 4 actions queued
   (No network requests made yet)

2. Sync to API
----------------------------------------
   Flushing queue...
   Synced: 4 actions
   Pending after sync: 0

3. Cryptographic receipts
----------------------------------------
   [1] act_01J8X7K2M...  sig: ed25519:Mzx0xEB...
   [2] act_01J8X7K3N...  sig: ed25519:Nzy1yFC...
   [3] act_01J8X7K4O...  sig: ed25519:Oaz2zGD...
   [4] act_01J8X7K5P...  sig: ed25519:Pba3aHE...

4. Verify receipt
----------------------------------------
   Valid:     true
   Key:       aira-signing-key-v1
   Receipt:   Action receipt exists and signing key is valid...

============================================================
  Done — queued 4 actions offline, synced with receipts
============================================================
```

## API Reference

| Method | Description |
|--------|-------------|
| `new Aira({ offline: true })` | Enable offline queuing |
| `aira.pendingCount` | Number of queued requests |
| `aira.sync()` | Flush queue to API, returns receipts |

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
