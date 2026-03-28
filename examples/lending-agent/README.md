# Lending Agent — Complete Aira TypeScript SDK Example

Demonstrates **every feature** of the `aira-sdk` TypeScript package.

## Features Covered

| # | Feature | Methods Used |
|---|---------|-------------|
| 1 | **Agent Registry** | `registerAgent`, `publishVersion`, `updateAgent`, `listAgents`, `getAgent`, `listVersions` |
| 2 | **Notarization** | `notarize` (with idempotency + chain of custody), `getAction`, `getActionChain`, `listActions` |
| 3 | **Consensus** | `runCase`, `listCases` |
| 4 | **Evidence** | `createEvidencePackage`, `listEvidencePackages`, `getEvidencePackage` |
| 5 | **Estate** | `setAgentWill`, `getAgentWill`, `createComplianceSnapshot`, `listComplianceSnapshots` |
| 6 | **Escrow** | `createEscrowAccount`, `escrowDeposit`, `escrowRelease`, `listEscrowAccounts` |
| 7 | **Chat** | `ask` |
| 8 | **Verification** | `verifyAction` (public, no auth) |
| 9 | **Error Handling** | `AiraError` with status, code, message |

## Setup

```bash
npm install aira-sdk
export AIRA_API_KEY="aira_live_xxx"    # https://app.airaproof.com/dashboard/api-keys
npx tsx examples/lending-agent/index.ts
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [GitHub — TypeScript SDK](https://github.com/aira-proof/typescript-sdk)
- [GitHub — Python SDK](https://github.com/aira-proof/python-sdk)
