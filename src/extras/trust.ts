/**
 * Trust layer types and helpers shared across all framework integrations.
 */

import type { Aira } from "../client";

/** Policy for automated trust checks before tool execution. */
export interface TrustPolicy {
  verifyCounterparty?: boolean;
  minReputation?: number;
  requireValidVc?: boolean;
  blockRevokedVc?: boolean;
  blockUnregistered?: boolean;
}

/** Result of a trust check against a counterparty agent. */
export interface TrustContext {
  counterpartyId?: string;
  didResolved?: boolean;
  did?: string;
  vcValid?: boolean | null;
  reputationScore?: number | null;
  reputationTier?: string | null;
  reputationWarning?: string;
  blocked?: boolean;
  blockReason?: string;
  recommendation?: string;
}

/**
 * Run a trust check against a counterparty agent.
 *
 * Advisory by default — populates TrustContext with warnings.
 * Only blocks when `blockRevokedVc` is set and the VC is revoked,
 * or when `blockUnregistered` is set and the DID cannot be resolved.
 */
export async function checkTrust(
  client: Aira,
  policy: TrustPolicy,
  counterpartyId: string,
): Promise<TrustContext> {
  const ctx: TrustContext = {
    counterpartyId,
    blocked: false,
  };

  // Step 1: Resolve DID
  if (policy.verifyCounterparty || policy.requireValidVc || policy.blockUnregistered) {
    try {
      const didResult = await client.resolveDid(`did:web:airaproof.com:agents:${counterpartyId}`);
      ctx.didResolved = true;
      ctx.did = (didResult as Record<string, unknown>).did as string | undefined;
    } catch {
      ctx.didResolved = false;
      if (policy.blockUnregistered) {
        ctx.blocked = true;
        ctx.blockReason = `Agent '${counterpartyId}' DID could not be resolved`;
        return ctx;
      }
      ctx.recommendation = `Could not resolve DID for '${counterpartyId}' — proceed with caution`;
      return ctx;
    }
  }

  // Step 2: Verify credential
  if (policy.requireValidVc || policy.blockRevokedVc) {
    try {
      const cred = await client.getAgentCredential(counterpartyId);
      const verification = await client.verifyCredential(cred);
      const valid = (verification as Record<string, unknown>).valid as boolean;
      ctx.vcValid = valid;

      if (!valid && policy.blockRevokedVc) {
        ctx.blocked = true;
        ctx.blockReason = `Agent '${counterpartyId}' has a revoked or invalid credential`;
        return ctx;
      }
      if (!valid) {
        ctx.recommendation = `Credential for '${counterpartyId}' is invalid — proceed with caution`;
      }
    } catch {
      ctx.vcValid = null;
      if (policy.blockRevokedVc) {
        ctx.recommendation = `Could not verify credential for '${counterpartyId}' — treating as unknown`;
      }
    }
  }

  // Step 3: Check reputation
  if (policy.minReputation != null) {
    try {
      const rep = await client.getReputation(counterpartyId);
      ctx.reputationScore = (rep as Record<string, unknown>).score as number | null;
      ctx.reputationTier = (rep as Record<string, unknown>).tier as string | null;

      if (ctx.reputationScore != null && ctx.reputationScore < policy.minReputation) {
        ctx.reputationWarning = `Reputation ${ctx.reputationScore} is below minimum ${policy.minReputation}`;
        ctx.recommendation = ctx.reputationWarning;
      }
    } catch {
      ctx.reputationScore = null;
      ctx.reputationWarning = `Could not fetch reputation for '${counterpartyId}'`;
    }
  }

  return ctx;
}
