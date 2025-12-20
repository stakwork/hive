import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockPusherState, mockPusherState } from "@/lib/mock/pusher-state";

describe("MockPusherState", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const instance1 = MockPusherState.getInstance();
      const instance2 = MockPusherState.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should return the same instance as exported constant", () => {
      const instance = MockPusherState.getInstance();
      expect(instance).toBe(mockPusherState);
    });
  });

  describe("Event Triggering", () => {
    it("should store triggered events", () => {
      mockPusherState.trigger("test-channel", "test-event", { foo: "bar" });

      const events = mockPusherState.getChannelEvents("test-channel");
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("test-event");
      expect(events[0].data).toEqual({ foo: "bar" });
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it("should store multiple events on the same channel", () => {
      mockPusherState.trigger("test-channel", "event-1", { id: 1 });
      mockPusherState.trigger("test-channel", "event-2", { id: 2 });
      mockPusherState.trigger("test-channel", "event-3", { id: 3 });

      const events = mockPusherState.getChannelEvents("test-channel");
      expect(events).toHaveLength(3);
      expect(events[0].data.id).toBe(1);
      expect(events[1].data.id).toBe(2);
      expect(events[2].data.id).toBe(3);
    });

    it("should store events on different channels independently", () => {
      mockPusherState.trigger("channel-1", "event-a", { ch: 1 });
      mockPusherState.trigger("channel-2", "event-b", { ch: 2 });

      const events1 = mockPusherState.getChannelEvents("channel-1");
      const events2 = mockPusherState.getChannelEvents("channel-2");

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].data.ch).toBe(1);
      expect(events2[0].data.ch).toBe(2);
    });
  });

  describe("Subscriptions", () => {
    it("should return a mock channel object", () => {
      const channel = mockPusherState.subscribe("test-channel");

      expect(channel).toBeDefined();
      expect(channel.channelName).toBe("test-channel");
      expect(typeof channel.bind).toBe("function");
      expect(typeof channel.unbind).toBe("function");
      expect(typeof channel.unbind_all).toBe("function");
    });

    it("should trigger subscription_succeeded event", (done) => {
      const channel = mockPusherState.subscribe("test-channel");
      const callback = vi.fn(() => {
        expect(callback).toHaveBeenCalledWith({});
        done();
      });

      channel.bind("pusher:subscription_succeeded", callback);
    });

    it("should invoke callback when event is triggered", () => {
      const callback = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", callback);

      mockPusherState.trigger("test-channel", "test-event", { foo: "bar" });

      expect(callback).toHaveBeenCalledWith({ foo: "bar" });
    });

    it("should invoke multiple callbacks for the same event", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", callback1);
      channel.bind("test-event", callback2);

      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(callback1).toHaveBeenCalledWith({ data: 1 });
      expect(callback2).toHaveBeenCalledWith({ data: 1 });
    });

    it("should not invoke callbacks for different events", () => {
      const callback = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("event-a", callback);

      mockPusherState.trigger("test-channel", "event-b", { data: 1 });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should not invoke callbacks for different channels", () => {
      const callback = vi.fn();
      const channel = mockPusherState.subscribe("channel-1");
      channel.bind("test-event", callback);

      mockPusherState.trigger("channel-2", "test-event", { data: 1 });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("Unsubscriptions", () => {
    it("should remove specific callback with unbind", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", callback1);
      channel.bind("test-event", callback2);

      channel.unbind("test-event", callback1);
      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ data: 1 });
    });

    it("should remove all callbacks for an event with unbind", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", callback1);
      channel.bind("test-event", callback2);

      channel.unbind("test-event");
      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should remove all callbacks with unbind_all", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("event-a", callback1);
      channel.bind("event-b", callback2);

      channel.unbind_all();
      mockPusherState.trigger("test-channel", "event-a", { data: 1 });
      mockPusherState.trigger("test-channel", "event-b", { data: 2 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should remove all subscribers with unsubscribe", () => {
      const callback = vi.fn();
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", callback);

      mockPusherState.unsubscribe("test-channel");
      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("Polling", () => {
    it("should return all events when no timestamp is provided", () => {
      mockPusherState.trigger("channel-1", "event-1", { id: 1 });
      mockPusherState.trigger("channel-2", "event-2", { id: 2 });

      const result = mockPusherState.poll(["channel-1", "channel-2"]);

      expect(result["channel-1"]).toHaveLength(1);
      expect(result["channel-2"]).toHaveLength(1);
      expect(result["channel-1"][0].data.id).toBe(1);
      expect(result["channel-2"][0].data.id).toBe(2);
    });

    it("should return only events after the since timestamp", () => {
      vi.useFakeTimers();
      
      // Trigger first event at time 1000
      vi.setSystemTime(1000);
      mockPusherState.trigger("test-channel", "event-1", { id: 1 });

      // Advance time and trigger second event at time 1010
      vi.setSystemTime(1010);
      mockPusherState.trigger("test-channel", "event-2", { id: 2 });

      // Poll for events after timestamp 1005 (should only get event-2)
      const result = mockPusherState.poll(["test-channel"], 1005);

      expect(result["test-channel"]).toHaveLength(1);
      expect(result["test-channel"][0].data.id).toBe(2);

      vi.useRealTimers();
    });

    it("should return empty array for channels with no events", () => {
      const result = mockPusherState.poll(["non-existent-channel"]);

      expect(result["non-existent-channel"]).toEqual([]);
    });

    it("should handle multiple channels in single poll", () => {
      mockPusherState.trigger("channel-1", "event", { ch: 1 });
      mockPusherState.trigger("channel-2", "event", { ch: 2 });
      mockPusherState.trigger("channel-3", "event", { ch: 3 });

      const result = mockPusherState.poll(["channel-1", "channel-2", "channel-3"]);

      expect(Object.keys(result)).toHaveLength(3);
      expect(result["channel-1"][0].data.ch).toBe(1);
      expect(result["channel-2"][0].data.ch).toBe(2);
      expect(result["channel-3"][0].data.ch).toBe(3);
    });
  });

  describe("Cleanup and TTL", () => {
    it("should remove events older than TTL", () => {
      vi.useFakeTimers();

      mockPusherState.trigger("test-channel", "old-event", { id: 1 });

      // Advance time by 61 seconds (past TTL of 60s)
      vi.advanceTimersByTime(61000);

      // Trigger cleanup
      mockPusherState.cleanup();

      const events = mockPusherState.getChannelEvents("test-channel");
      expect(events).toHaveLength(0);

      vi.useRealTimers();
    });

    it("should keep events within TTL", () => {
      vi.useFakeTimers();

      mockPusherState.trigger("test-channel", "recent-event", { id: 1 });

      // Advance time by 30 seconds (within TTL of 60s)
      vi.advanceTimersByTime(30000);

      mockPusherState.cleanup();

      const events = mockPusherState.getChannelEvents("test-channel");
      expect(events).toHaveLength(1);

      vi.useRealTimers();
    });

    it("should remove empty channels during cleanup", () => {
      vi.useFakeTimers();

      mockPusherState.trigger("test-channel", "event", { id: 1 });

      // Advance time past TTL
      vi.advanceTimersByTime(61000);
      mockPusherState.cleanup();

      const stats = mockPusherState.getStats();
      expect(stats.channelCount).toBe(0);

      vi.useRealTimers();
    });

    it("should not remove channels with active subscribers", () => {
      vi.useFakeTimers();

      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", vi.fn());

      mockPusherState.trigger("test-channel", "event", { id: 1 });

      // Advance time past TTL
      vi.advanceTimersByTime(61000);
      mockPusherState.cleanup();

      const stats = mockPusherState.getStats();
      expect(stats.channelCount).toBe(1); // Channel still exists due to subscriber

      vi.useRealTimers();
    });
  });

  describe("Statistics", () => {
    it("should return accurate channel count", () => {
      mockPusherState.trigger("channel-1", "event", { id: 1 });
      mockPusherState.trigger("channel-2", "event", { id: 2 });

      const stats = mockPusherState.getStats();
      expect(stats.channelCount).toBe(2);
    });

    it("should return accurate event count", () => {
      mockPusherState.trigger("channel-1", "event-1", { id: 1 });
      mockPusherState.trigger("channel-1", "event-2", { id: 2 });
      mockPusherState.trigger("channel-2", "event-3", { id: 3 });

      const stats = mockPusherState.getStats();
      expect(stats.totalEventCount).toBe(3);
    });

    it("should return accurate subscriber count", () => {
      const channel1 = mockPusherState.subscribe("channel-1");
      const channel2 = mockPusherState.subscribe("channel-2");

      channel1.bind("event-a", vi.fn());
      channel1.bind("event-b", vi.fn());
      channel2.bind("event-c", vi.fn());

      const stats = mockPusherState.getStats();
      expect(stats.totalSubscriberCount).toBe(3);
    });

    it("should return per-channel statistics", () => {
      mockPusherState.trigger("channel-1", "event", { id: 1 });
      mockPusherState.trigger("channel-1", "event", { id: 2 });

      const channel = mockPusherState.subscribe("channel-1");
      channel.bind("event", vi.fn());

      const stats = mockPusherState.getStats();
      expect(stats.channels["channel-1"].eventCount).toBe(2);
      expect(stats.channels["channel-1"].subscriberCount).toBe(1);
    });
  });

  describe("Reset", () => {
    it("should clear all channels and events", () => {
      mockPusherState.trigger("channel-1", "event", { id: 1 });
      mockPusherState.trigger("channel-2", "event", { id: 2 });
      const channel = mockPusherState.subscribe("channel-3");
      channel.bind("event", vi.fn());

      mockPusherState.reset();

      const stats = mockPusherState.getStats();
      expect(stats.channelCount).toBe(0);
      expect(stats.totalEventCount).toBe(0);
      expect(stats.totalSubscriberCount).toBe(0);
    });

    it("should allow new subscriptions after reset", () => {
      const channel1 = mockPusherState.subscribe("test-channel");
      channel1.bind("event", vi.fn());

      mockPusherState.reset();

      const callback = vi.fn();
      const channel2 = mockPusherState.subscribe("test-channel");
      channel2.bind("test-event", callback);

      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(callback).toHaveBeenCalledWith({ data: 1 });
    });
  });

  describe("Error Handling", () => {
    it("should catch and log errors in subscriber callbacks", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const errorCallback = vi.fn(() => {
        throw new Error("Test error");
      });
      const normalCallback = vi.fn();

      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("test-event", errorCallback);
      channel.bind("test-event", normalCallback);

      mockPusherState.trigger("test-channel", "test-event", { data: 1 });

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalledWith({ data: 1 });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Channel Isolation", () => {
    it("should isolate events between channels", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const channel1 = mockPusherState.subscribe("channel-1");
      const channel2 = mockPusherState.subscribe("channel-2");

      channel1.bind("test-event", callback1);
      channel2.bind("test-event", callback2);

      mockPusherState.trigger("channel-1", "test-event", { ch: 1 });

      expect(callback1).toHaveBeenCalledWith({ ch: 1 });
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should isolate subscribers between channels", () => {
      const callback = vi.fn();
      const channel1 = mockPusherState.subscribe("channel-1");
      channel1.bind("test-event", callback);

      mockPusherState.unsubscribe("channel-1");

      // Subscribe to different channel with same callback
      const channel2 = mockPusherState.subscribe("channel-2");
      channel2.bind("test-event", callback);

      mockPusherState.trigger("channel-1", "test-event", { data: 1 });
      mockPusherState.trigger("channel-2", "test-event", { data: 2 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ data: 2 });
    });
  });

  describe("hasSubscribers", () => {
    it("should return true for channels with subscribers", () => {
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("event", vi.fn());

      expect(mockPusherState.hasSubscribers("test-channel")).toBe(true);
    });

    it("should return false for channels without subscribers", () => {
      expect(mockPusherState.hasSubscribers("non-existent-channel")).toBe(false);
    });

    it("should return false after unsubscribing", () => {
      const channel = mockPusherState.subscribe("test-channel");
      channel.bind("event", vi.fn());

      mockPusherState.unsubscribe("test-channel");

      expect(mockPusherState.hasSubscribers("test-channel")).toBe(false);
    });
  });
});
