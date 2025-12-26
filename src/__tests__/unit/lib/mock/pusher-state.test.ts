import { describe, it, expect, beforeEach, vi } from "vitest";
import { pusherMockState } from "@/lib/mock/pusher-state";

describe("PusherMockStateManager", () => {
  beforeEach(() => {
    pusherMockState.reset();
  });

  describe("Connection Management", () => {
    it("should generate unique connection IDs", () => {
      const id1 = pusherMockState.generateConnectionId();
      const id2 = pusherMockState.generateConnectionId();
      const id3 = pusherMockState.generateConnectionId();

      expect(id1).toMatch(/^mock-connection-\d+$/);
      expect(id2).toMatch(/^mock-connection-\d+$/);
      expect(id3).toMatch(/^mock-connection-\d+$/);
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });

    it("should reset connection ID counter", () => {
      const id1 = pusherMockState.generateConnectionId();
      pusherMockState.reset();
      const id2 = pusherMockState.generateConnectionId();

      expect(id1).toBe("mock-connection-1");
      expect(id2).toBe("mock-connection-1");
    });
  });

  describe("Channel Subscription", () => {
    it("should subscribe connection to channel", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";

      pusherMockState.subscribe(connectionId, channelName);

      const channelState = pusherMockState.getChannelState(channelName);
      expect(channelState).toBeDefined();
      expect(channelState!.subscribers.has(connectionId)).toBe(true);
    });

    it("should track multiple subscribers on same channel", () => {
      const conn1 = "test-conn-1";
      const conn2 = "test-conn-2";
      const channelName = "test-channel";

      pusherMockState.subscribe(conn1, channelName);
      pusherMockState.subscribe(conn2, channelName);

      const count = pusherMockState.getSubscriberCount(channelName);
      expect(count).toBe(2);
    });

    it("should unsubscribe connection from channel", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.unsubscribe(connectionId, channelName);

      const count = pusherMockState.getSubscriberCount(channelName);
      expect(count).toBe(0);
    });

    it("should clean up channel when last subscriber leaves", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.unsubscribe(connectionId, channelName);

      const channelState = pusherMockState.getChannelState(channelName);
      expect(channelState).toBeUndefined();
    });

    it("should handle subscribing to multiple channels", () => {
      const connectionId = "test-conn-1";
      const channel1 = "channel-1";
      const channel2 = "channel-2";

      pusherMockState.subscribe(connectionId, channel1);
      pusherMockState.subscribe(connectionId, channel2);

      const subscription = pusherMockState.getSubscriptionState(connectionId);
      expect(subscription!.channels.size).toBe(2);
      expect(subscription!.channels.has(channel1)).toBe(true);
      expect(subscription!.channels.has(channel2)).toBe(true);
    });
  });

  describe("Event Binding", () => {
    it("should bind event callback for connection", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, eventName, callback);

      const channelState = pusherMockState.getChannelState(channelName);
      expect(channelState!.eventCallbacks.has(eventName)).toBe(true);
    });

    it("should execute callback when event triggered", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, eventName, callback);

      pusherMockState.trigger(channelName, eventName, { message: "hello" });

      expect(callback).toHaveBeenCalledWith({ message: "hello" });
    });

    it("should handle multiple callbacks for same event", () => {
      const conn1 = "test-conn-1";
      const conn2 = "test-conn-2";
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      pusherMockState.subscribe(conn1, channelName);
      pusherMockState.subscribe(conn2, channelName);
      pusherMockState.bind(conn1, channelName, eventName, callback1);
      pusherMockState.bind(conn2, channelName, eventName, callback2);

      pusherMockState.trigger(channelName, eventName, { count: 42 });

      expect(callback1).toHaveBeenCalledWith({ count: 42 });
      expect(callback2).toHaveBeenCalledWith({ count: 42 });
    });

    it("should unbind specific callback", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, eventName, callback1);
      pusherMockState.bind(connectionId, channelName, eventName, callback2);

      pusherMockState.unbind(connectionId, channelName, eventName, callback1);

      pusherMockState.trigger(channelName, eventName, { test: true });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ test: true });
    });

    it("should unbind all callbacks for event", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, eventName, callback1);
      pusherMockState.bind(connectionId, channelName, eventName, callback2);

      pusherMockState.unbind(connectionId, channelName, eventName);

      pusherMockState.trigger(channelName, eventName, { test: true });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should not execute callback for different event", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const callback = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, "event-1", callback);

      pusherMockState.trigger(channelName, "event-2", { data: "test" });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";
      const eventName = "test-event";
      const errorCallback = vi.fn(() => {
        throw new Error("Callback error");
      });
      const successCallback = vi.fn();

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.bind(connectionId, channelName, eventName, errorCallback);
      pusherMockState.bind(connectionId, channelName, eventName, successCallback);

      // Should not throw
      expect(() => {
        pusherMockState.trigger(channelName, eventName, { data: "test" });
      }).not.toThrow();

      // Success callback should still execute
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe("Message History", () => {
    it("should store message in channel history", () => {
      const channelName = "test-channel";
      const eventName = "test-event";
      const data = { message: "hello" };

      pusherMockState.trigger(channelName, eventName, data);

      const messages = pusherMockState.getChannelMessages(channelName);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        channel: channelName,
        event: eventName,
        data,
      });
    });

    it("should maintain message history limit of 100", () => {
      const channelName = "test-channel";
      const eventName = "test-event";

      // Trigger 150 messages
      for (let i = 0; i < 150; i++) {
        pusherMockState.trigger(channelName, eventName, { index: i });
      }

      const messages = pusherMockState.getChannelMessages(channelName);
      expect(messages).toHaveLength(100);

      // Should contain messages 50-149 (oldest 50 discarded)
      expect(messages[0].data).toEqual({ index: 50 });
      expect(messages[99].data).toEqual({ index: 149 });
    });

    it("should include timestamp in message", () => {
      const channelName = "test-channel";
      const eventName = "test-event";

      const beforeTime = Date.now();
      pusherMockState.trigger(channelName, eventName, { test: true });
      const afterTime = Date.now();

      const messages = pusherMockState.getChannelMessages(channelName);
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(messages[0].timestamp).toBeLessThanOrEqual(afterTime);
    });

    it("should get messages since timestamp", async () => {
      const channelName = "test-channel";
      const eventName = "test-event";

      pusherMockState.trigger(channelName, eventName, { index: 1 });
      const midTime = Date.now();
      
      // Add small delay to ensure subsequent messages have later timestamps
      await new Promise((resolve) => setTimeout(resolve, 2));
      
      pusherMockState.trigger(channelName, eventName, { index: 2 });
      pusherMockState.trigger(channelName, eventName, { index: 3 });

      const recentMessages = pusherMockState.getMessagesSince(channelName, midTime);
      expect(recentMessages.length).toBeGreaterThanOrEqual(2);
      expect(recentMessages.every((msg) => msg.timestamp > midTime)).toBe(true);
    });

    it("should return empty array for non-existent channel", () => {
      const messages = pusherMockState.getChannelMessages("non-existent");
      expect(messages).toEqual([]);
    });
  });

  describe("Connection Disconnect", () => {
    it("should remove all subscriptions on disconnect", () => {
      const connectionId = "test-conn-1";
      const channel1 = "channel-1";
      const channel2 = "channel-2";

      pusherMockState.subscribe(connectionId, channel1);
      pusherMockState.subscribe(connectionId, channel2);

      pusherMockState.disconnect(connectionId);

      const subscription = pusherMockState.getSubscriptionState(connectionId);
      expect(subscription).toBeUndefined();

      expect(pusherMockState.getSubscriberCount(channel1)).toBe(0);
      expect(pusherMockState.getSubscriberCount(channel2)).toBe(0);
    });

    it("should not affect other connections on disconnect", () => {
      const conn1 = "test-conn-1";
      const conn2 = "test-conn-2";
      const channelName = "test-channel";

      pusherMockState.subscribe(conn1, channelName);
      pusherMockState.subscribe(conn2, channelName);

      pusherMockState.disconnect(conn1);

      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);
    });
  });

  describe("State Management", () => {
    it("should reset all state", () => {
      const connectionId = "test-conn-1";
      const channelName = "test-channel";

      pusherMockState.subscribe(connectionId, channelName);
      pusherMockState.trigger(channelName, "event", { data: "test" });

      pusherMockState.reset();

      expect(pusherMockState.getChannelState(channelName)).toBeUndefined();
      expect(pusherMockState.getSubscriptionState(connectionId)).toBeUndefined();
      expect(pusherMockState.getActiveChannels()).toEqual([]);
    });

    it("should get state snapshot", () => {
      const conn1 = "test-conn-1";
      const conn2 = "test-conn-2";
      const channel1 = "channel-1";
      const channel2 = "channel-2";

      pusherMockState.subscribe(conn1, channel1);
      pusherMockState.subscribe(conn2, channel1);
      pusherMockState.subscribe(conn2, channel2);

      const state = pusherMockState.getState();

      expect(state.channels).toHaveLength(2);
      expect(state.subscriptions).toHaveLength(2);

      const channel1State = state.channels.find((c) => c.name === channel1);
      expect(channel1State!.subscriberCount).toBe(2);
    });

    it("should list active channels", () => {
      pusherMockState.subscribe("conn-1", "channel-1");
      pusherMockState.subscribe("conn-2", "channel-2");

      const channels = pusherMockState.getActiveChannels();
      expect(channels).toContain("channel-1");
      expect(channels).toContain("channel-2");
      expect(channels).toHaveLength(2);
    });
  });

  describe("Channel Isolation", () => {
    it("should not deliver messages across different channels", () => {
      const conn1 = "test-conn-1";
      const conn2 = "test-conn-2";
      const channel1 = "channel-1";
      const channel2 = "channel-2";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      pusherMockState.subscribe(conn1, channel1);
      pusherMockState.subscribe(conn2, channel2);
      pusherMockState.bind(conn1, channel1, "event", callback1);
      pusherMockState.bind(conn2, channel2, "event", callback2);

      pusherMockState.trigger(channel1, "event", { message: "hello" });

      expect(callback1).toHaveBeenCalledWith({ message: "hello" });
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should maintain separate message history per channel", () => {
      const channel1 = "channel-1";
      const channel2 = "channel-2";

      pusherMockState.trigger(channel1, "event", { channel: 1 });
      pusherMockState.trigger(channel2, "event", { channel: 2 });

      const messages1 = pusherMockState.getChannelMessages(channel1);
      const messages2 = pusherMockState.getChannelMessages(channel2);

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(1);
      expect(messages1[0].data).toEqual({ channel: 1 });
      expect(messages2[0].data).toEqual({ channel: 2 });
    });
  });
});
