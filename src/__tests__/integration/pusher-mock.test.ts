import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pusherMockState } from "@/lib/mock/pusher-state";
import { MockPusherServer, MockPusherClient } from "@/lib/mock/pusher-wrapper";

describe("Pusher Mock Integration", () => {
  let server: MockPusherServer;
  let client1: MockPusherClient;
  let client2: MockPusherClient;

  beforeEach(() => {
    pusherMockState.reset();

    server = new MockPusherServer({
      appId: "test-app-id",
      key: "test-key",
      secret: "test-secret",
      cluster: "test-cluster",
      useTLS: true,
    });

    client1 = new MockPusherClient("test-key", { cluster: "test-cluster" });
    client2 = new MockPusherClient("test-key", { cluster: "test-cluster" });
  });

  afterEach(() => {
    client1.disconnect();
    client2.disconnect();
    pusherMockState.reset();
  });

  describe("End-to-End Message Delivery", () => {
    it("should deliver message from server to subscribed client", async () => {
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback = vi.fn();

      const channel = client1.subscribe(channelName);
      channel.bind(eventName, callback);

      await server.trigger(channelName, eventName, { message: "hello" });

      expect(callback).toHaveBeenCalledWith({ message: "hello" });
    });

    it("should deliver messages to multiple subscribers", async () => {
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const channel1 = client1.subscribe(channelName);
      const channel2 = client2.subscribe(channelName);

      channel1.bind(eventName, callback1);
      channel2.bind(eventName, callback2);

      await server.trigger(channelName, eventName, { count: 42 });

      expect(callback1).toHaveBeenCalledWith({ count: 42 });
      expect(callback2).toHaveBeenCalledWith({ count: 42 });
    });

    it("should not deliver messages to unsubscribed clients", async () => {
      const channelName = "test-channel";
      const eventName = "test-event";
      const callback = vi.fn();

      const channel = client1.subscribe(channelName);
      channel.bind(eventName, callback);

      // Unsubscribe before trigger
      client1.unsubscribe(channelName);

      await server.trigger(channelName, eventName, { message: "test" });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should deliver messages with <200ms latency", async () => {
      const channelName = "test-channel";
      const eventName = "test-event";

      let receivedTime: number | null = null;
      const callback = vi.fn(() => {
        receivedTime = Date.now();
      });

      const channel = client1.subscribe(channelName);
      channel.bind(eventName, callback);

      const triggerTime = Date.now();
      await server.trigger(channelName, eventName, { test: true });

      // Callback should be executed immediately (no polling delay in test)
      expect(callback).toHaveBeenCalled();
      expect(receivedTime).not.toBeNull();
      const latency = receivedTime! - triggerTime;
      expect(latency).toBeLessThan(200);
    });
  });

  describe("Channel Subscriptions", () => {
    it("should handle subscribe/bind lifecycle", () => {
      const channelName = "task-123";
      const channel = client1.subscribe(channelName);

      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);

      const callback = vi.fn();
      channel.bind("new-message", callback);

      pusherMockState.trigger(channelName, "new-message", { id: "msg-1" });
      expect(callback).toHaveBeenCalledWith({ id: "msg-1" });
    });

    it("should handle multiple channels per client", async () => {
      const channel1 = client1.subscribe("channel-1");
      const channel2 = client1.subscribe("channel-2");

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      channel1.bind("event", callback1);
      channel2.bind("event", callback2);

      await server.trigger("channel-1", "event", { channel: 1 });
      await server.trigger("channel-2", "event", { channel: 2 });

      expect(callback1).toHaveBeenCalledWith({ channel: 1 });
      expect(callback2).toHaveBeenCalledWith({ channel: 2 });
    });

    it("should reuse existing channel on re-subscribe", () => {
      const channelName = "test-channel";
      const channel1 = client1.subscribe(channelName);
      const channel2 = client1.subscribe(channelName);

      expect(channel1).toBe(channel2);
      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);
    });
  });

  describe("Event Binding", () => {
    it("should bind multiple events on same channel", async () => {
      const channel = client1.subscribe("test-channel");

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      channel.bind("event-1", callback1);
      channel.bind("event-2", callback2);

      await server.trigger("test-channel", "event-1", { type: 1 });
      await server.trigger("test-channel", "event-2", { type: 2 });

      expect(callback1).toHaveBeenCalledWith({ type: 1 });
      expect(callback2).toHaveBeenCalledWith({ type: 2 });
    });

    it("should unbind specific event callback", async () => {
      const channel = client1.subscribe("test-channel");

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      channel.bind("event", callback1);
      channel.bind("event", callback2);

      channel.unbind("event", callback1);

      await server.trigger("test-channel", "event", { test: true });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ test: true });
    });

    it("should unbind all events when no event specified", async () => {
      const channel = client1.subscribe("test-channel");

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      channel.bind("event-1", callback1);
      channel.bind("event-2", callback2);

      channel.unbind();

      await server.trigger("test-channel", "event-1", { test: true });
      await server.trigger("test-channel", "event-2", { test: true });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should support method chaining", () => {
      const channel = client1.subscribe("test-channel");

      const result = channel.bind("event-1", vi.fn()).bind("event-2", vi.fn());

      expect(result).toBe(channel);
    });
  });

  describe("Message History", () => {
    it("should store message history per channel", async () => {
      await server.trigger("channel-1", "event", { index: 1 });
      await server.trigger("channel-1", "event", { index: 2 });
      await server.trigger("channel-2", "event", { index: 3 });

      const history1 = pusherMockState.getChannelMessages("channel-1");
      const history2 = pusherMockState.getChannelMessages("channel-2");

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(1);
    });

    it("should maintain 100 message limit per channel", async () => {
      const channelName = "test-channel";

      // Trigger messages without waiting for individual delays
      const triggers = [];
      for (let i = 0; i < 150; i++) {
        triggers.push(server.trigger(channelName, "event", { index: i }));
      }
      await Promise.all(triggers);

      const history = pusherMockState.getChannelMessages(channelName);
      expect(history).toHaveLength(100);

      // Should contain most recent 100 messages (50-149)
      expect(history[0].data).toEqual({ index: 50 });
      expect(history[99].data).toEqual({ index: 149 });
    }, 10000); // Increase timeout to 10 seconds
  });

  describe("Connection Management", () => {
    it("should provide connected state", () => {
      expect(client1.connection.state).toBe("connected");
    });

    it("should execute connected callback", async () => {
      const promise = new Promise<void>((resolve) => {
        client1.connection.bind("connected", () => {
          resolve();
        });
      });
      
      await promise;
    });

    it("should cleanup on disconnect", () => {
      const channelName = "test-channel";
      const channel = client1.subscribe(channelName);
      channel.bind("event", vi.fn());

      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);

      client1.disconnect();

      expect(pusherMockState.getSubscriberCount(channelName)).toBe(0);
      expect(client1.connection.state).toBe("disconnected");
    });

    it("should support multiple independent connections", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const channel1 = client1.subscribe("channel");
      const channel2 = client2.subscribe("channel");

      channel1.bind("event", callback1);
      channel2.bind("event", callback2);

      client1.disconnect();

      await server.trigger("channel", "event", { test: true });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ test: true });
    });
  });

  describe("Real-World Scenarios", () => {
    it("should handle task channel message flow", async () => {
      const taskId = "task-123";
      const channelName = `task-${taskId}`;

      const callback = vi.fn();
      const channel = client1.subscribe(channelName);
      channel.bind("new-message", callback);

      // Simulate server broadcasting new message
      await server.trigger(channelName, "new-message", {
        messageId: "msg-456",
      });

      expect(callback).toHaveBeenCalledWith({ messageId: "msg-456" });
    });

    it("should handle workspace channel recommendations", async () => {
      const workspaceSlug = "test-workspace";
      const channelName = `workspace-${workspaceSlug}`;

      const callback = vi.fn();
      const channel = client1.subscribe(channelName);
      channel.bind("recommendations-updated", callback);

      await server.trigger(channelName, "recommendations-updated", {
        count: 5,
        timestamp: Date.now(),
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 5,
        }),
      );
    });

    it("should handle multiple clients on same task", async () => {
      const channelName = "task-789";
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client1.subscribe(channelName).bind("task-title-update", callback1);
      client2.subscribe(channelName).bind("task-title-update", callback2);

      await server.trigger(channelName, "task-title-update", {
        title: "Updated Title",
      });

      expect(callback1).toHaveBeenCalledWith({ title: "Updated Title" });
      expect(callback2).toHaveBeenCalledWith({ title: "Updated Title" });
    });

    it("should handle unsubscribe during active session", async () => {
      const channelName = "task-999";
      const callback = vi.fn();

      const channel = client1.subscribe(channelName);
      channel.bind("event", callback);

      await server.trigger(channelName, "event", { count: 1 });

      client1.unsubscribe(channelName);

      await server.trigger(channelName, "event", { count: 2 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ count: 1 });
    });
  });

  describe("Batch Operations", () => {
    it("should handle batch trigger", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client1.subscribe("channel-1").bind("event", callback1);
      client1.subscribe("channel-2").bind("event", callback2);

      await server.triggerBatch([
        { channel: "channel-1", name: "event", data: { id: 1 } },
        { channel: "channel-2", name: "event", data: { id: 2 } },
      ]);

      expect(callback1).toHaveBeenCalledWith({ id: 1 });
      expect(callback2).toHaveBeenCalledWith({ id: 2 });
    });
  });

  describe("State Isolation", () => {
    it("should maintain separate state per test via reset", () => {
      client1.subscribe("channel-1");
      pusherMockState.reset();

      expect(pusherMockState.getActiveChannels()).toEqual([]);
      expect(pusherMockState.getSubscriberCount("channel-1")).toBe(0);
    });

    it("should cleanup all connections on reset", () => {
      const conn1Id = (client1 as any).connectionId;

      client1.subscribe("channel-1");
      pusherMockState.reset();

      const subscription = pusherMockState.getSubscriptionState(conn1Id);
      expect(subscription).toBeUndefined();
    });
  });
});
