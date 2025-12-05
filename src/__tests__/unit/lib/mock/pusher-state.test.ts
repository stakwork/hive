import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPusherState } from "@/lib/mock/pusher-state";

describe("MockPusherStateManager", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  describe("trigger()", () => {
    it("should trigger events on a single channel", async () => {
      await mockPusherState.trigger("workspace-test", "test-event", {
        foo: "bar",
      });

      const history = mockPusherState.getEventHistory("workspace-test");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        channel: "workspace-test",
        event: "test-event",
        data: { foo: "bar" },
      });
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it("should trigger events on multiple channels", async () => {
      await mockPusherState.trigger(
        ["channel-a", "channel-b"],
        "multi-event",
        { count: 42 }
      );

      const historyA = mockPusherState.getEventHistory("channel-a");
      const historyB = mockPusherState.getEventHistory("channel-b");

      expect(historyA).toHaveLength(1);
      expect(historyB).toHaveLength(1);
      expect(historyA[0].data).toEqual({ count: 42 });
      expect(historyB[0].data).toEqual({ count: 42 });
    });

    it("should broadcast to subscribers", async () => {
      const receivedEvents: unknown[] = [];
      const callback = (data: unknown) => receivedEvents.push(data);

      mockPusherState.subscribe("workspace-test", "update", callback);

      await mockPusherState.trigger("workspace-test", "update", {
        status: "complete",
      });

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual({ status: "complete" });
    });

    it("should broadcast to multiple subscribers", async () => {
      const events1: unknown[] = [];
      const events2: unknown[] = [];

      mockPusherState.subscribe("channel-1", "event", (data) =>
        events1.push(data)
      );
      mockPusherState.subscribe("channel-1", "event", (data) =>
        events2.push(data)
      );

      await mockPusherState.trigger("channel-1", "event", { msg: "hello" });

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it("should respect channel:event scoping", async () => {
      const events: unknown[] = [];

      mockPusherState.subscribe("channel-a", "event-1", (data) =>
        events.push(data)
      );

      // Different channel - should not receive
      await mockPusherState.trigger("channel-b", "event-1", { value: 1 });
      expect(events).toHaveLength(0);

      // Different event - should not receive
      await mockPusherState.trigger("channel-a", "event-2", { value: 2 });
      expect(events).toHaveLength(0);

      // Matching channel + event - should receive
      await mockPusherState.trigger("channel-a", "event-1", { value: 3 });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ value: 3 });
    });
  });

  describe("triggerBatch()", () => {
    it("should trigger multiple events in batch", async () => {
      await mockPusherState.triggerBatch([
        { channel: "ch-1", name: "event-a", data: { a: 1 } },
        { channel: "ch-2", name: "event-b", data: { b: 2 } },
      ]);

      const history = mockPusherState.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        channel: "ch-1",
        event: "event-a",
        data: { a: 1 },
      });
      expect(history[1]).toMatchObject({
        channel: "ch-2",
        event: "event-b",
        data: { b: 2 },
      });
    });
  });

  describe("subscribe()", () => {
    it("should subscribe to channel events", () => {
      const callback = vi.fn();
      const unsubscribe = mockPusherState.subscribe(
        "test-channel",
        "test-event",
        callback
      );

      expect(typeof unsubscribe).toBe("function");
      expect(
        mockPusherState.getListenerCount("test-channel", "test-event")
      ).toBe(1);
    });

    it("should return unsubscribe function", async () => {
      const callback = vi.fn();
      const unsubscribe = mockPusherState.subscribe(
        "test-channel",
        "test-event",
        callback
      );

      await mockPusherState.trigger("test-channel", "test-event", {});
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await mockPusherState.trigger("test-channel", "test-event", {});
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe("getEventHistory()", () => {
    it("should return all events when no channel specified", async () => {
      await mockPusherState.trigger("ch-1", "event-1", {});
      await mockPusherState.trigger("ch-2", "event-2", {});

      const history = mockPusherState.getEventHistory();
      expect(history).toHaveLength(2);
    });

    it("should filter by channel when specified", async () => {
      await mockPusherState.trigger("ch-1", "event-1", {});
      await mockPusherState.trigger("ch-2", "event-2", {});
      await mockPusherState.trigger("ch-1", "event-3", {});

      const history = mockPusherState.getEventHistory("ch-1");
      expect(history).toHaveLength(2);
      expect(history[0].channel).toBe("ch-1");
      expect(history[1].channel).toBe("ch-1");
    });

    it("should limit history size to maxHistorySize", async () => {
      // Trigger 150 events (max is 100)
      for (let i = 0; i < 150; i++) {
        await mockPusherState.trigger("test", "event", { count: i });
      }

      const history = mockPusherState.getEventHistory();
      expect(history).toHaveLength(100);

      // Should keep the most recent 100
      expect(history[0].data).toEqual({ count: 50 });
      expect(history[99].data).toEqual({ count: 149 });
    });
  });

  describe("reset()", () => {
    it("should clear event history", async () => {
      await mockPusherState.trigger("test", "event", {});
      expect(mockPusherState.getEventHistory()).toHaveLength(1);

      mockPusherState.reset();
      expect(mockPusherState.getEventHistory()).toHaveLength(0);
    });

    it("should remove all listeners", async () => {
      const callback = vi.fn();
      mockPusherState.subscribe("test", "event", callback);
      expect(mockPusherState.getListenerCount("test", "event")).toBe(1);

      mockPusherState.reset();
      expect(mockPusherState.getListenerCount("test", "event")).toBe(0);

      await mockPusherState.trigger("test", "event", {});
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getListenerCount()", () => {
    it("should return correct listener count", () => {
      expect(mockPusherState.getListenerCount("test", "event")).toBe(0);

      const unsub1 = mockPusherState.subscribe("test", "event", () => {});
      expect(mockPusherState.getListenerCount("test", "event")).toBe(1);

      const unsub2 = mockPusherState.subscribe("test", "event", () => {});
      expect(mockPusherState.getListenerCount("test", "event")).toBe(2);

      unsub1();
      expect(mockPusherState.getListenerCount("test", "event")).toBe(1);

      unsub2();
      expect(mockPusherState.getListenerCount("test", "event")).toBe(0);
    });
  });
});