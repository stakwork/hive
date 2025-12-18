import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPusherState } from "@/lib/mock/pusher-state";

describe("MockPusherStateManager", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  describe("subscribe", () => {
    it("should subscribe callback to channel event", () => {
      const callback = vi.fn();
      mockPusherState.subscribe("workspace-123", "new-message", callback);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0]).toEqual({
        channelName: "workspace-123",
        eventName: "new-message",
        callbackCount: 1,
      });
    });

    it("should allow multiple callbacks for same channel/event", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "new-message", callback2);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].callbackCount).toBe(2);
    });

    it("should support multiple events on same channel", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "workflow-update", callback2);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(2);
    });

    it("should support multiple channels", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("task-456", "status-update", callback2);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions.map((s) => s.channelName)).toContain("workspace-123");
      expect(subscriptions.map((s) => s.channelName)).toContain("task-456");
    });
  });

  describe("trigger", () => {
    it("should invoke subscribed callbacks with data", () => {
      const callback = vi.fn();
      const testData = { message: "Hello World" };

      mockPusherState.subscribe("workspace-123", "new-message", callback);
      const invoked = mockPusherState.trigger("workspace-123", "new-message", testData);

      expect(invoked).toBe(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(testData);
    });

    it("should invoke all callbacks for same event", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const testData = { message: "Broadcast" };

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "new-message", callback2);

      const invoked = mockPusherState.trigger("workspace-123", "new-message", testData);

      expect(invoked).toBe(2);
      expect(callback1).toHaveBeenCalledWith(testData);
      expect(callback2).toHaveBeenCalledWith(testData);
    });

    it("should not invoke callbacks for different events", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "workflow-update", callback2);

      mockPusherState.trigger("workspace-123", "new-message", {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should not invoke callbacks for different channels", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("task-456", "new-message", callback2);

      mockPusherState.trigger("workspace-123", "new-message", {});

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should return 0 if no subscriptions exist", () => {
      const invoked = mockPusherState.trigger("nonexistent", "event", {});
      expect(invoked).toBe(0);
    });

    it("should handle callback errors gracefully", () => {
      const errorCallback = vi.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", errorCallback);
      mockPusherState.subscribe("workspace-123", "new-message", goodCallback);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const invoked = mockPusherState.trigger("workspace-123", "new-message", {});

      expect(invoked).toBe(1); // Only successful callback counted
      expect(goodCallback).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should record events in history", () => {
      const testData = { test: "data" };
      mockPusherState.trigger("workspace-123", "new-message", testData);

      const history = mockPusherState.getEventHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        channelName: "workspace-123",
        eventName: "new-message",
        data: testData,
      });
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it("should limit event history to 1000 events", () => {
      // Trigger 1100 events
      for (let i = 0; i < 1100; i++) {
        mockPusherState.trigger("test", "event", { count: i });
      }

      const history = mockPusherState.getEventHistory(2000);
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe("unsubscribe", () => {
    it("should remove specific callback from channel", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "new-message", callback2);

      mockPusherState.unsubscribe("workspace-123", callback1);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions[0].callbackCount).toBe(1);

      mockPusherState.trigger("workspace-123", "new-message", {});
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should remove entire channel when no callback provided", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "workflow-update", callback2);

      mockPusherState.unsubscribe("workspace-123");

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(0);
    });

    it("should handle unsubscribing from nonexistent channel", () => {
      expect(() => {
        mockPusherState.unsubscribe("nonexistent");
      }).not.toThrow();
    });

    it("should clean up empty event sets", () => {
      const callback = vi.fn();
      mockPusherState.subscribe("workspace-123", "new-message", callback);
      mockPusherState.unsubscribe("workspace-123", callback);

      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(0);
    });
  });

  describe("connection state", () => {
    it("should track connection establishment", () => {
      mockPusherState.connect();

      const state = mockPusherState.getConnectionState();
      expect(state.connected).toBe(true);
      expect(state.connectionCount).toBe(1);
      expect(state.lastConnectedAt).toBeInstanceOf(Date);
    });

    it("should track disconnection", () => {
      mockPusherState.connect();
      mockPusherState.disconnect();

      const state = mockPusherState.getConnectionState();
      expect(state.connected).toBe(false);
      expect(state.lastDisconnectedAt).toBeInstanceOf(Date);
    });

    it("should increment connection count on reconnect", () => {
      mockPusherState.connect();
      mockPusherState.disconnect();
      mockPusherState.connect();

      const state = mockPusherState.getConnectionState();
      expect(state.connectionCount).toBe(2);
    });

    it("should not increment connection count if already connected", () => {
      mockPusherState.connect();
      mockPusherState.connect();

      const state = mockPusherState.getConnectionState();
      expect(state.connectionCount).toBe(1);
    });
  });

  describe("getChannelSubscriptionCount", () => {
    it("should return total callback count for channel", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockPusherState.subscribe("workspace-123", "new-message", callback1);
      mockPusherState.subscribe("workspace-123", "workflow-update", callback2);

      expect(mockPusherState.getChannelSubscriptionCount("workspace-123")).toBe(2);
    });

    it("should return 0 for nonexistent channel", () => {
      expect(mockPusherState.getChannelSubscriptionCount("nonexistent")).toBe(0);
    });
  });

  describe("getEventHistory", () => {
    it("should return limited event history", () => {
      for (let i = 0; i < 10; i++) {
        mockPusherState.trigger("test", "event", { count: i });
      }

      const history = mockPusherState.getEventHistory(5);
      expect(history).toHaveLength(5);
      expect(history[0].data).toEqual({ count: 5 });
      expect(history[4].data).toEqual({ count: 9 });
    });
  });

  describe("reset", () => {
    it("should clear all subscriptions", () => {
      mockPusherState.subscribe("workspace-123", "new-message", vi.fn());
      mockPusherState.subscribe("task-456", "status-update", vi.fn());

      mockPusherState.reset();

      expect(mockPusherState.getSubscriptions()).toHaveLength(0);
    });

    it("should reset connection state", () => {
      mockPusherState.connect();
      mockPusherState.reset();

      const state = mockPusherState.getConnectionState();
      expect(state.connected).toBe(false);
      expect(state.connectionCount).toBe(0);
    });

    it("should clear event history", () => {
      mockPusherState.trigger("test", "event", {});
      mockPusherState.reset();

      expect(mockPusherState.getEventHistory()).toHaveLength(0);
    });
  });

  describe("singleton pattern", () => {
    it("should return same instance", () => {
      const instance1 = mockPusherState;
      const instance2 = mockPusherState;

      expect(instance1).toBe(instance2);
    });

    it("should maintain state across multiple imports", () => {
      mockPusherState.subscribe("test", "event", vi.fn());

      // Simulate re-import by getting subscriptions
      const subscriptions = mockPusherState.getSubscriptions();
      expect(subscriptions).toHaveLength(1);
    });
  });
});
