/**
 * AiraSession — scoped session with pre-filled defaults for `authorize()`.
 *
 * Under the two-step flow, only `authorize()` takes agent/model metadata;
 * `notarize()` operates on an existing action_id. This session therefore
 * merges defaults on `authorize()` only and provides a thin passthrough
 * for `notarize()` so callers can use a single object end-to-end.
 */

import type { Aira } from "./client";
import type { Authorization, ActionReceipt } from "./types";

export class AiraSession {
  private client: Aira;
  private defaults: Record<string, unknown>;

  constructor(client: Aira, agentId: string, defaults?: Record<string, unknown>) {
    this.client = client;
    this.defaults = { agentId, ...(defaults ?? {}) };
  }

  async authorize(params: {
    actionType: string;
    details: string;
    instructionHash?: string;
    modelId?: string;
    modelVersion?: string;
    parentActionId?: string;
    endpointUrl?: string;
    storeDetails?: boolean;
    idempotencyKey?: string;
    requireApproval?: boolean;
    approvers?: string[];
  }): Promise<Authorization> {
    const merged = {
      agentId: this.defaults.agentId as string,
      ...(this.defaults.modelId ? { modelId: this.defaults.modelId as string } : {}),
      ...(this.defaults.agentVersion ? { agentVersion: this.defaults.agentVersion as string } : {}),
      ...params,
    };
    return this.client.authorize(merged);
  }

  async notarize(params: {
    actionId: string;
    outcome?: "completed" | "failed";
    outcomeDetails?: string;
  }): Promise<ActionReceipt> {
    return this.client.notarize(params);
  }
}
