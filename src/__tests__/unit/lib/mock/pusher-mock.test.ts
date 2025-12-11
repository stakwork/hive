import { describe, it, expect, beforeEach } from "vitest";
import { pusherMockState } from "@/lib/mock/pusher-state";
import { PusherServerMock } from "@/lib/mock/pusher-server-wrapper";
import { PusherClientMock } from "@/lib/mock/pusher-client-wrapper";

describe("Pusher Mock System", () => {
  beforeEach(() => {
    // Reset state before each test
    pusherMockState.reset();
  });

  describe("PusherMockState", () => {
    it("should handle channel subscription and event triggering", () => {
      const channelName = "test-channel";
      const subscriberId = "test-subscriber";
      
      // Subscribe to channel
      pusherMockState.subscribe(channelName, subscriberId);
      
      // Verify channel was created
      expect(pusherMockState.getChannels()).toContain(channelName);
      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);
    });

    it("should deliver events to subscribers synchronously", () => {
      const channelName = "test-channel";
      const subscriberId = "test-subscriber";
      const receivedEvents: any[] = [];
      
      // Subscribe and bind callback
      pusherMockState.subscribe(channelName, subscriberId);
      pusherMockState.bind(subscriberId, channelName, "test-event", (data: any) => {
        receivedEvents.push(data);
      });
      
      // Trigger event
      pusherMockState.trigger(channelName, "test-event", { message: "Hello" });
      
      // Verify immediate delivery
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual({ message: "Hello" });
    });

    it("should store event history", () => {
      const channelName = "test-channel";
      
      // Trigger multiple events
      pusherMockState.trigger(channelName, "event1", { data: 1 });
      pusherMockState.trigger(channelName, "event2", { data: 2 });
      pusherMockState.trigger(channelName, "event3", { data: 3 });
      
      // Verify history
      const history = pusherMockState.getChannelHistory(channelName);
      expect(history).toHaveLength(3);
      expect(history[0].event).toBe("event1");
      expect(history[1].event).toBe("event2");
      expect(history[2].event).toBe("event3");
    });

    it("should limit history to 100 events", () => {
      const channelName = "test-channel";
      
      // Trigger 150 events
      for (let i = 0; i < 150; i++) {
        pusherMockState.trigger(channelName, "event", { index: i });
      }
      
      // Verify history is limited
      const history = pusherMockState.getChannelHistory(channelName);
      expect(history).toHaveLength(100);
      expect(history[0].data.index).toBe(50); // First 50 were trimmed
    });

    it("should handle multiple subscribers on same channel", () => {
      const channelName = "test-channel";
      const subscriber1 = "sub1";
      const subscriber2 = "sub2";
      const received1: any[] = [];
      const received2: any[] = [];
      
      // Subscribe both
      pusherMockState.subscribe(channelName, subscriber1);
      pusherMockState.subscribe(channelName, subscriber2);
      
      // Bind callbacks
      pusherMockState.bind(subscriber1, channelName, "event", (data: any) => {
        received1.push(data);
      });
      pusherMockState.bind(subscriber2, channelName, "event", (data: any) => {
        received2.push(data);
      });
      
      // Trigger event
      pusherMockState.trigger(channelName, "event", { value: 42 });
      
      // Both should receive
      expect(received1).toEqual([{ value: 42 }]);
      expect(received2).toEqual([{ value: 42 }]);
    });

    it("should clean up on unsubscribe", () => {
      const channelName = "test-channel";
      const subscriberId = "test-subscriber";
      
      pusherMockState.subscribe(channelName, subscriberId);
      expect(pusherMockState.getSubscriberCount(channelName)).toBe(1);
      
      pusherMockState.unsubscribe(subscriberId, channelName);
      expect(pusherMockState.getSubscriberCount(channelName)).toBe(0);
      expect(pusherMockState.getChannels()).not.toContain(channelName);
    });
  });

  describe("PusherServerMock", () => {
    it("should trigger events on single channel", async () => {
      const server = new PusherServerMock();
      const channelName = "task-123";
      const subscriberId = "sub1";
      const received: any[] = [];
      
      // Setup subscriber
      pusherMockState.subscribe(channelName, subscriberId);
      pusherMockState.bind(subscriberId, channelName, "new-message", (data: any) => {
        received.push(data);
      });
      
      // Trigger via server
      const response = await server.trigger(channelName, "new-message", {
        messageId: "msg-456",
      });
      
      // Verify
      expect(response.status).toBe(200);
      expect(received).toEqual([{ messageId: "msg-456" }]);
    });

    it("should trigger events on multiple channels", async () => {
      const server = new PusherServerMock();
      const channels = ["task-123", "workspace-test"];
      const received: Record<string, any[]> = { "task-123": [], "workspace-test": [] };
      
      // Setup subscribers for both channels
      channels.forEach((channel) => {
        const subscriberId = `sub-${channel}`;
        pusherMockState.subscribe(channel, subscriberId);
        pusherMockState.bind(subscriberId, channel, "update", (data: any) => {
          received[channel].push(data);
        });
      });
      
      // Trigger on both channels
      await server.trigger(channels, "update", { value: 42 });
      
      // Both should receive
      expect(received["task-123"]).toEqual([{ value: 42 }]);
      expect(received["workspace-test"]).toEqual([{ value: 42 }]);
    });
  });

  describe("PusherClientMock", () => {
    it("should subscribe to channel and bind events", () => {
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      const received: any[] = [];
      
      // Subscribe
      const channel = client.subscribe("test-channel");
      
      // Bind event
      channel.bind("test-event", (data: any) => {
        received.push(data);
      });
      
      // Trigger event
      pusherMockState.trigger("test-channel", "test-event", { hello: "world" });
      
      // Verify
      expect(received).toEqual([{ hello: "world" }]);
    });

    it("should support unbind", () => {
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      const received: any[] = [];
      
      const channel = client.subscribe("test-channel");
      const callback = (data: any) => received.push(data);
      
      channel.bind("event", callback);
      pusherMockState.trigger("test-channel", "event", { value: 1 });
      
      channel.unbind("event", callback);
      pusherMockState.trigger("test-channel", "event", { value: 2 });
      
      // Should only receive first event
      expect(received).toEqual([{ value: 1 }]);
    });

    it("should support unsubscribe", () => {
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      const received: any[] = [];
      
      const channel = client.subscribe("test-channel");
      channel.bind("event", (data: any) => received.push(data));
      
      client.unsubscribe("test-channel");
      pusherMockState.trigger("test-channel", "event", { value: 1 });
      
      // Should not receive after unsubscribe
      expect(received).toEqual([]);
    });

    it("should disconnect from all channels", () => {
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      
      client.subscribe("channel1");
      client.subscribe("channel2");
      client.subscribe("channel3");
      
      expect(client.allChannels()).toHaveLength(3);
      
      client.disconnect();
      
      expect(client.allChannels()).toHaveLength(0);
    });
  });

  describe("Integration: Server → Client", () => {
    it("should deliver messages from server to client", async () => {
      const server = new PusherServerMock();
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      const received: any[] = [];
      
      // Client subscribes
      const channel = client.subscribe("task-123");
      channel.bind("new-message", (data: any) => {
        received.push(data);
      });
      
      // Server triggers
      await server.trigger("task-123", "new-message", {
        messageId: "msg-789",
        text: "Hello from server",
      });
      
      // Client receives
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        messageId: "msg-789",
        text: "Hello from server",
      });
    });

    it("should support task and workspace channels", async () => {
      const server = new PusherServerMock();
      const client = new PusherClientMock("mock-key", { cluster: "mock" });
      const taskMessages: any[] = [];
      const workspaceMessages: any[] = [];
      
      // Subscribe to both channel types
      const taskChannel = client.subscribe("task-123");
      const workspaceChannel = client.subscribe("workspace-myworkspace");
      
      taskChannel.bind("task-title-update", (data: any) => {
        taskMessages.push(data);
      });
      
      workspaceChannel.bind("workspace-task-title-update", (data: any) => {
        workspaceMessages.push(data);
      });
      
      // Trigger on both
      await server.trigger("task-123", "task-title-update", {
        taskId: "123",
        title: "Updated",
      });
      
      await server.trigger("workspace-myworkspace", "workspace-task-title-update", {
        taskId: "123",
        title: "Updated",
      });
      
      // Verify both received
      expect(taskMessages).toHaveLength(1);
      expect(workspaceMessages).toHaveLength(1);
    });
  });

  describe("Debug utilities", () => {
    it("should provide debug info", () => {
      pusherMockState.subscribe("channel1", "sub1");
      pusherMockState.subscribe("channel2", "sub2");
      pusherMockState.trigger("channel1", "event1", {});
      pusherMockState.trigger("channel1", "event2", {});
      
      const info = pusherMockState.getDebugInfo();
      
      expect(info.channels).toBe(2);
      expect(info.totalSubscribers).toBe(2);
      expect(info.totalEvents).toBe(2);
    });

    it("should support history with limit", () => {
      const channelName = "test-channel";
      
      for (let i = 0; i < 20; i++) {
        pusherMockState.trigger(channelName, "event", { index: i });
      }
      
      const last5 = pusherMockState.getChannelHistory(channelName, 5);
      
      expect(last5).toHaveLength(5);
      expect(last5[0].data.index).toBe(15);
      expect(last5[4].data.index).toBe(19);
    });
  });
});
