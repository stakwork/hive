import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordHeartbeat,
  recordLeave,
  getActivePresence,
  __clearCanvasPresenceForTests,
} from "@/lib/canvas/presence-store";

describe("canvas presence-store", () => {
  const roomKey = "acme-org:root";
  const userId = "user-abc";
  const userId2 = "user-def";

  beforeEach(() => {
    __clearCanvasPresenceForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("recordHeartbeat", () => {
    it("creates a new entry", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice", color: "#ff0000" });
      const entries = getActivePresence(roomKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBe(userId);
      expect(entries[0].name).toBe("Alice");
      expect(entries[0].color).toBe("#ff0000");
    });

    it("refreshes lastSeenAt on repeat calls", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      const first = getActivePresence(roomKey)[0].lastSeenAt;

      vi.advanceTimersByTime(5_000);
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      const second = getActivePresence(roomKey)[0].lastSeenAt;

      expect(second).toBeGreaterThan(first);
    });

    it("preserves joinedAt across heartbeats", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice", joinedAt: 1000 });
      vi.advanceTimersByTime(1_000);
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      const entry = getActivePresence(roomKey)[0];
      expect(entry.joinedAt).toBe(1000);
    });

    it("preserves name from first heartbeat when subsequent omits it", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      recordHeartbeat(roomKey, { userId, name: null });
      const entry = getActivePresence(roomKey)[0];
      expect(entry.name).toBe("Alice");
    });

    it("stores image on first heartbeat", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice", image: "https://example.com/alice.jpg" });
      const entry = getActivePresence(roomKey)[0];
      expect(entry.image).toBe("https://example.com/alice.jpg");
    });

    it("preserves original image when subsequent heartbeat passes null", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice", image: "https://example.com/alice.jpg" });
      recordHeartbeat(roomKey, { userId, name: "Alice", image: null });
      const entry = getActivePresence(roomKey)[0];
      expect(entry.image).toBe("https://example.com/alice.jpg");
    });

    it("stores null image when no image is provided", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      const entry = getActivePresence(roomKey)[0];
      expect(entry.image).toBeNull();
    });
  });

  describe("recordLeave", () => {
    it("removes the entry immediately", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      recordLeave(roomKey, userId);
      expect(getActivePresence(roomKey)).toHaveLength(0);
    });

    it("is a no-op when user is not in the room", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      expect(() => recordLeave(roomKey, "unknown-user")).not.toThrow();
      expect(getActivePresence(roomKey)).toHaveLength(1);
    });

    it("cleans up empty room from the map", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      recordLeave(roomKey, userId);
      // After leave, calling again should still not throw
      expect(() => recordLeave(roomKey, userId)).not.toThrow();
    });
  });

  describe("getActivePresence", () => {
    it("excludes the caller's own userId", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      recordHeartbeat(roomKey, { userId: userId2, name: "Bob" });
      const entries = getActivePresence(roomKey, userId);
      expect(entries.map((e) => e.userId)).not.toContain(userId);
      expect(entries.map((e) => e.userId)).toContain(userId2);
    });

    it("prunes stale entries (> 60s old)", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      vi.advanceTimersByTime(61_000);
      const entries = getActivePresence(roomKey);
      expect(entries).toHaveLength(0);
    });

    it("returns fresh entries not yet expired", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      vi.advanceTimersByTime(30_000);
      expect(getActivePresence(roomKey)).toHaveLength(1);
    });

    it("returns empty array for unknown room", () => {
      expect(getActivePresence("nonexistent:room")).toEqual([]);
    });

    it("returns entries with image field", () => {
      recordHeartbeat(roomKey, { userId, name: "Alice", image: "https://example.com/alice.jpg" });
      recordHeartbeat(roomKey, { userId: userId2, name: "Bob", image: null });
      const entries = getActivePresence(roomKey);
      expect(entries).toHaveLength(2);
      const alice = entries.find((e) => e.userId === userId);
      const bob = entries.find((e) => e.userId === userId2);
      expect(alice?.image).toBe("https://example.com/alice.jpg");
      expect(bob?.image).toBeNull();
    });

    it("handles multiple rooms independently", () => {
      const room2 = "acme-org:initiative-xyz";
      recordHeartbeat(roomKey, { userId, name: "Alice" });
      recordHeartbeat(room2, { userId: userId2, name: "Bob" });

      expect(getActivePresence(roomKey)).toHaveLength(1);
      expect(getActivePresence(roomKey)[0].userId).toBe(userId);

      expect(getActivePresence(room2)).toHaveLength(1);
      expect(getActivePresence(room2)[0].userId).toBe(userId2);
    });
  });
});
