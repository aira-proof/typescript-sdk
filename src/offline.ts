/**
 * Offline queue for Aira SDK — queues actions locally, syncs later.
 */

import { randomUUID } from "crypto";

export interface QueuedRequest {
  id: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export class OfflineQueue {
  private items: QueuedRequest[] = [];

  enqueue(method: string, path: string, body: Record<string, unknown>): string {
    const id = `offline_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.items.push({ id, method, path, body });
    return id;
  }

  get pendingCount(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  drain(): QueuedRequest[] {
    const drained = [...this.items];
    this.items = [];
    return drained;
  }
}
