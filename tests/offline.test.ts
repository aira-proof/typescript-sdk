import { describe, it, expect } from "vitest";
import { OfflineQueue } from "../src/offline";

describe("OfflineQueue", () => {
  it("starts empty", () => {
    const q = new OfflineQueue();
    expect(q.pendingCount).toBe(0);
  });

  it("enqueue adds items and returns id", () => {
    const q = new OfflineQueue();
    const id = q.enqueue("POST", "/actions", { action_type: "test" });

    expect(id).toMatch(/^offline_/);
    expect(q.pendingCount).toBe(1);
  });

  it("enqueue multiple items", () => {
    const q = new OfflineQueue();
    q.enqueue("POST", "/actions", { action_type: "a" });
    q.enqueue("POST", "/actions", { action_type: "b" });
    q.enqueue("POST", "/actions", { action_type: "c" });

    expect(q.pendingCount).toBe(3);
  });

  it("drain returns all items and empties queue", () => {
    const q = new OfflineQueue();
    q.enqueue("POST", "/actions", { action_type: "a" });
    q.enqueue("POST", "/actions", { action_type: "b" });

    const items = q.drain();
    expect(items).toHaveLength(2);
    expect(q.pendingCount).toBe(0);

    // Verify item structure
    expect(items[0].method).toBe("POST");
    expect(items[0].path).toBe("/actions");
    expect(items[0].body).toEqual({ action_type: "a" });
    expect(items[0].id).toMatch(/^offline_/);
  });

  it("clear empties the queue", () => {
    const q = new OfflineQueue();
    q.enqueue("POST", "/actions", { action_type: "a" });
    q.enqueue("POST", "/actions", { action_type: "b" });

    q.clear();
    expect(q.pendingCount).toBe(0);
  });

  it("drain after drain returns empty", () => {
    const q = new OfflineQueue();
    q.enqueue("POST", "/actions", { action_type: "a" });
    q.drain();
    expect(q.drain()).toEqual([]);
  });

  it("each enqueue generates unique id", () => {
    const q = new OfflineQueue();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(q.enqueue("POST", "/actions", {}));
    }
    expect(ids.size).toBe(50);
  });
});
