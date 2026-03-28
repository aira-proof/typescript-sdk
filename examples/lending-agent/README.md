# Lending Agent — Complete Aira TypeScript SDK Example

A lending agent that demonstrates **every feature** of the `aira-sdk` TypeScript package.

## Features Covered

| # | Feature | Methods Used |
|---|---------|-------------|
| 1 | **Agent Registry** | `registerAgent`, `publishVersion`, `updateAgent`, `listAgents`, `getAgent`, `listVersions` |
| 2 | **Notarization** | `notarize` (with idempotency), chain of custody (`parentActionId`), `getAction`, `getActionChain`, `listActions` |
| 3 | **Multi-Model Consensus** | `runCase`, `listCases` |
| 4 | **Evidence** | `createEvidencePackage`, `listEvidencePackages`, `getEvidencePackage` |
| 5 | **Estate & Compliance** | `setAgentWill`, `getAgentWill`, `createComplianceSnapshot`, `listComplianceSnapshots` |
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

## Output

```
============================================================
  Aira Lending Agent — TypeScript SDK Demo
============================================================

1. Agent Registry
----------------------------------------
   ✓ Registered: lending-agent-ts
   ✓ Version: 1.0.0
   ✓ Updated description
   ✓ 6 agent(s) in registry
   ✓ Status: active
   ✓ 1 version(s)

2. Action Notarization
----------------------------------------
   ✓ Notarized: act_01J8X...
   ✓ Signature: ed25519:Mzx0xEB...
   ✓ Chained: act_01J8Y...
   ✓ Type: loan_decision
   ✓ Chain: 2 action(s)
   ✓ Loan decisions: 5

3. Multi-Model Consensus
----------------------------------------
   ✓ Decision: APPROVE
   ✓ Confidence: 0.89
   ✓ Total cases: 12

4. Evidence & Discovery
----------------------------------------
   ✓ Sealed: "Loan Decision — Maria Schmidt (TS)"
   ✓ Hash: sha256:c6f4a2b8e91b...
   ✓ Total packages: 8
   ✓ Retrieved: Loan Decision — Maria Schmidt (TS)

5. Agent Estate & Compliance
----------------------------------------
   ✓ Will set: 2555-day retention
   ✓ Policy: transfer_to_successor
   ✓ EU AI Act: compliant
   ✓ Snapshots: 3

6. Escrow (Liability Commitments)
----------------------------------------
   ✓ Account: esc_01J8Z...
   ✓ Committed: €1,500
   ✓ Released: €1,500
   ✓ Accounts: 2

7. Ask Aira
----------------------------------------
   ✓ Today you notarized 5 loan decisions across...

8. Public Verification
----------------------------------------
   ✓ Valid: true
   ✓ Key: aira-signing-key-v1
   ✓ Action receipt exists and signing key is valid...

9. Error Handling
----------------------------------------
   ✓ Caught: [NOT_FOUND] Action receipt not found

============================================================
  All 9 feature areas demonstrated.
  Dashboard: https://app.airaproof.com
  Docs:      https://docs.airaproof.com
  SDK:       npm install aira-sdk
============================================================
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [API Reference](https://docs.airaproof.com/docs/api-reference)
- [GitHub — TypeScript SDK](https://github.com/aira-proof/typescript-sdk)
- [GitHub — Python SDK](https://github.com/aira-proof/python-sdk)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
