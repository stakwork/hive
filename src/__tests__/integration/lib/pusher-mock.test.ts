import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPusherState } from "@/lib/mock/pusher-state";

// Set environment BEFORE importing pusher module
process.env.USE_MOCKS = "true";

import { pusherServer, getPusherClient } from "@/lib/pusher";

describe("Pusher Mock Integration", () => {
  describe("Server-to-Client Broadcasting", () => {
    it("should broadcast from server to client", async () => {
      const client = getPusherClient();
      const channel = client.subscribe("workspace-test");

      const receivedEvents: unknown[] = [];
      channel.bind("status-update", (data: unknown) => {
        receivedEvents.push(data);
      });

      // Trigger from server
      await pusherServer.trigger("workspace-test", "status-update", {
        status: "complete",
        taskId: "task-123",
      });

      // Events should be delivered synchronously in mock mode
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual({
        status: "complete",
        taskId: "task-123",
      });
    });

    it("should support multiple subscribers on same channel", async () => {
      const client1 = getPusherClient();
      const client2 = getPusherClient();

      const channel1 = client1.subscribe("workspace-test");
      const channel2 = client2.subscribe("workspace-test");

      const events1: unknown[] = [];
      const events2: unknown[] = [];

      channel1.bind("update", (data: unknown) => events1.push(data));
      channel2.bind("update", (data: unknown) => events2.push(data));

      await pusherServer.trigger("workspace-test", "update", { count: 42 });

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]).toEqual({ count: 42 });
      expect(events2[0]).toEqual({ count: 42 });
    });

    it("should support dual-channel broadcasting pattern", async () => {
      const client = getPusherClient();
      const taskChannel = client.subscribe("task-abc");
      const workspaceChannel = client.subscribe("workspace-xyz");

      const taskEvents: unknown[] = [];
      const workspaceEvents: unknown[] = [];

      taskChannel.bind("workflow-status-update", (data: unknown) =>
        taskEvents.push(data)
      );
      workspaceChannel.bind("workflow-status-update", (data: unknown) =>
        workspaceEvents.push(data)
      );

      // Simulate dual broadcast (task detail + workspace list)
      await pusherServer.trigger(
        ["task-abc", "workspace-xyz"],
        "workflow-status-update",
        { taskId: "abc", workflowStatus: "COMPLETED" }
      );

      expect(taskEvents).toHaveLength(1);
      expect(workspaceEvents).toHaveLength(1);
      expect(taskEvents[0]).toEqual({
        taskId: "abc",
        workflowStatus: "COMPLETED",
      });
    });
  });

  describe("Channel Lifecycle", () => {
    it("should support channel subscription and unsubscription", async () => {
      const client = getPusherClient();
      const channel = client.subscribe("test-channel");

      const events: unknown[] = [];
      channel.bind("test-event", (data: unknown) => events.push(data));

      await pusherServer.trigger("test-channel", "test-event", { value: 1 });
      expect(events).toHaveLength(1);

      client.unsubscribe("test-channel");

      await pusherServer.trigger("test-channel", "test-event", { value: 2 });
      expect(events).toHaveLength(1); // Still 1, not 2
    });

    it("should support event unbinding", async () => {
      const client = getPusherClient();
      const channel = client.subscribe("test-channel");

      const events: unknown[] = [];
      const callback = (data: unknown) => events.push(data);

      channel.bind("test-event", callback);

      await pusherServer.trigger("test-channel", "test-event", { value: 1 });
      expect(events).toHaveLength(1);

      channel.unbind("test-event", callback);

      await pusherServer.trigger("test-channel", "test-event", { value: 2 });
      expect(events).toHaveLength(1);
    });

    it("should support unbind_all", async () => {
      const client = getPusherClient();
      const channel = client.subscribe("test-channel");

      const events: unknown[] = [];

      channel.bind("event-a", (data: unknown) => events.push(data));
      channel.bind("event-b", (data: unknown) => events.push(data));

      await pusherServer.trigger("test-channel", "event-a", {});
      await pusherServer.trigger("test-channel", "event-b", {});
      expect(events).toHaveLength(2);

      channel.unbind_all();

      await pusherServer.trigger("test-channel", "event-a", {});
      await pusherServer.trigger("test-channel", "event-b", {});
      expect(events).toHaveLength(2); // Still 2, no new events
    });
  });

  describe("Batch Operations", () => {
    it("should support triggerBatch", async () => {
      const client = getPusherClient();
      const channel1 = client.subscribe("channel-1");
      const channel2 = client.subscribe("channel-2");

      const events1: unknown[] = [];
      const events2: unknown[] = [];

      channel1.bind("event", (data: unknown) => events1.push(data));
      channel2.bind("event", (data: unknown) => events2.push(data));

      await pusherServer.triggerBatch([
        { channel: "channel-1", name: "event", data: { id: 1 } },
        { channel: "channel-2", name: "event", data: { id: 2 } },
      ]);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]).toEqual({ id: 1 });
      expect(events2[0]).toEqual({ id: 2 });
    });
  });

  describe("Event History", () => {
    it("should track event history for debugging", async () => {
      await pusherServer.trigger("test-channel", "event-1", { a: 1 });
      await pusherServer.trigger("test-channel", "event-2", { b: 2 });

      const history = mockPusherState.getEventHistory("test-channel");
      expect(history).toHaveLength(2);
      expect(history[0].event).toBe("event-1");
      expect(history[1].event).toBe("event-2");
    });
  });
});
