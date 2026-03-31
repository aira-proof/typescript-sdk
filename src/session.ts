/**
 * AiraSession — scoped session with pre-filled defaults.
 */

import type { Aira } from "./client";
import type { ActionReceipt } from "./types";

export class AiraSession {
  private client: Aira;
  private defaults: Record<string, unknown>;

  constructor(client: Aira, agentId: string, defaults?: Record<string, unknown>) {
    this.client = client;
    this.defaults = { agentId, ...(defaults ?? {}) };
  }

  async notarize(params: {
    actionType: string;
    details: string;
    modelId?: string;
    modelVersion?: string;
    instructionHash?: string;
    parentActionId?: string;
    storeDetails?: boolean;
    idempotencyKey?: string;
  }): Promise<ActionReceipt> {
    const merged = {
      agentId: this.defaults.agentId as string,
      ...(this.defaults.modelId ? { modelId: this.defaults.modelId as string } : {}),
      ...(this.defaults.agentVersion ? { agentVersion: this.defaults.agentVersion as string } : {}),
      ...params,
    };
    return this.client.notarize(merged);
  }
}
