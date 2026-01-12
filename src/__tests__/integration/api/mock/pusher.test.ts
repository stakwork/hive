import { describe, it, expect, beforeEach } from "vitest";
import { mockPusherState } from "@/lib/mock/pusher-state";
import { POST as triggerPOST } from "@/app/api/mock/pusher/trigger/route";
import { GET as eventsGET } from "@/app/api/mock/pusher/events/route";
import {
  POST as subscribePOST,
  DELETE as subscribeDELETE,
} from "@/app/api/mock/pusher/subscribe/route";
import {
  POST as resetPOST,
  GET as resetGET,
} from "@/app/api/mock/pusher/reset/route";
import { NextRequest } from "next/server";

// Helper to create a GET request with query params
function createGetRequest(url: string): NextRequest {
  return new NextRequest(url);
}

// Helper to create a POST request with body
function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Helper to create a DELETE request with query params
function createDeleteRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "DELETE" });
}

describe("Mock Pusher API Endpoints", () => {
  beforeEach(() => {
    mockPusherState.reset();
  });

  describe("POST /api/mock/pusher/trigger", () => {
    it("stores event for single channel", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "new-message",
          data: { messageId: "msg-456" },
        }
      );

      const response = await triggerPOST(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.channels).toEqual(["task-123"]);

      const events = mockPusherState.getEvents("task-123");
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("new-message");
      expect(events[0].data).toEqual({ messageId: "msg-456" });
    });

    it("stores event for multiple channels", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: ["task-123", "workspace-acme"],
          event: "task-title-update",
          data: { taskId: "123", newTitle: "Updated" },
        }
      );

      const response = await triggerPOST(request);

      expect(response.status).toBe(200);

      const task123Events = mockPusherState.getEvents("task-123");
      const workspaceEvents = mockPusherState.getEvents("workspace-acme");

      expect(task123Events).toHaveLength(1);
      expect(workspaceEvents).toHaveLength(1);
      expect(task123Events[0].eventName).toBe("task-title-update");
      expect(workspaceEvents[0].eventName).toBe("task-title-update");
    });

    it("returns error for missing fields", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        { channels: "task-123" }
      );

      const response = await triggerPOST(request);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBeTruthy();
    });
  });

  describe("GET /api/mock/pusher/events", () => {
    beforeEach(async () => {
      // Trigger two events for testing
      const request1 = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "event-1",
          data: { test: 1 },
        }
      );
      await triggerPOST(request1);

      const request2 = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "event-2",
          data: { test: 2 },
        }
      );
      await triggerPOST(request2);
    });

    it("retrieves all events for channel", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/mock/pusher/events?channel=task-123"
      );

      const response = await eventsGET(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.channel).toBe("task-123");
      expect(result.events).toHaveLength(2);
      expect(result.events[0].eventName).toBe("event-1");
      expect(result.events[1].eventName).toBe("event-2");
    });

    it("retrieves events since lastEventId", async () => {
      const allEvents = mockPusherState.getEvents("task-123");
      const firstEventId = allEvents[0].id;

      const request = createGetRequest(
        `http://localhost:3000/api/mock/pusher/events?channel=task-123&lastEventId=${firstEventId}`
      );

      const response = await eventsGET(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventName).toBe("event-2");
    });

    it("returns empty array for channel with no events", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/mock/pusher/events?channel=task-999"
      );

      const response = await eventsGET(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.events).toHaveLength(0);
    });

    it("returns error for missing channel parameter", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/mock/pusher/events"
      );

      const response = await eventsGET(request);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBeTruthy();
    });
  });

  describe("POST /api/mock/pusher/subscribe", () => {
    it("creates subscription for channel", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/subscribe",
        { channel: "task-123" }
      );

      const response = await subscribePOST(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.subscription.channel).toBe("task-123");
      expect(result.subscription.subscriptionId).toBeTruthy();

      const hasSubscription = mockPusherState.hasSubscription("task-123");
      expect(hasSubscription).toBe(true);
    });

    it("returns error for missing channel", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/subscribe",
        {}
      );

      const response = await subscribePOST(request);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBeTruthy();
    });
  });

  describe("DELETE /api/mock/pusher/subscribe", () => {
    it("removes subscription", async () => {
      // First subscribe
      const subscribeRequest = createPostRequest(
        "http://localhost:3000/api/mock/pusher/subscribe",
        { channel: "task-123" }
      );
      const subscribeResponse = await subscribePOST(subscribeRequest);
      const subscribeResult = await subscribeResponse.json();
      const subscriptionId = subscribeResult.subscription.subscriptionId;

      // Then unsubscribe
      const unsubscribeRequest = createDeleteRequest(
        `http://localhost:3000/api/mock/pusher/subscribe?subscriptionId=${subscriptionId}`
      );
      const unsubscribeResponse = await subscribeDELETE(unsubscribeRequest);

      expect(unsubscribeResponse.status).toBe(200);
      const result = await unsubscribeResponse.json();
      expect(result.success).toBe(true);
    });
  });

  describe("POST /api/mock/pusher/reset", () => {
    beforeEach(async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: ["task-123", "workspace-acme"],
          event: "test-event",
          data: { test: true },
        }
      );
      await triggerPOST(request);
    });

    it("clears all state", async () => {
      const statsBefore = mockPusherState.getStats();
      expect(statsBefore.totalEvents).toBeGreaterThan(0);

      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/reset",
        {}
      );
      const response = await resetPOST(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.clearedStats.totalEvents).toBe(statsBefore.totalEvents);

      const statsAfter = mockPusherState.getStats();
      expect(statsAfter.totalEvents).toBe(0);
      expect(statsAfter.channelCount).toBe(0);
    });
  });

  describe("GET /api/mock/pusher/reset", () => {
    beforeEach(async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "test-event",
          data: { test: true },
        }
      );
      await triggerPOST(request);
    });

    it("returns stats without resetting", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/mock/pusher/reset"
      );
      const response = await resetGET(request);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.stats.totalEvents).toBeGreaterThan(0);

      const statsAfter = mockPusherState.getStats();
      expect(statsAfter.totalEvents).toBe(result.stats.totalEvents);
    });
  });

  describe("Event deduplication", () => {
    it("prevents duplicate event delivery with lastEventId", async () => {
      // Trigger first event
      const triggerRequest1 = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "event-1",
          data: { test: 1 },
        }
      );
      await triggerPOST(triggerRequest1);

      // First poll
      const firstPollRequest = createGetRequest(
        "http://localhost:3000/api/mock/pusher/events?channel=task-123"
      );
      const firstPoll = await eventsGET(firstPollRequest);
      const firstResult = await firstPoll.json();
      expect(firstResult.events).toHaveLength(1);

      const lastEventId = firstResult.events[0].id;

      // Second poll with lastEventId - should return nothing
      const secondPollRequest = createGetRequest(
        `http://localhost:3000/api/mock/pusher/events?channel=task-123&lastEventId=${lastEventId}`
      );
      const secondPoll = await eventsGET(secondPollRequest);
      const secondResult = await secondPoll.json();
      expect(secondResult.events).toHaveLength(0);

      // Trigger second event
      const triggerRequest2 = createPostRequest(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          channels: "task-123",
          event: "event-2",
          data: { test: 2 },
        }
      );
      await triggerPOST(triggerRequest2);

      // Third poll with lastEventId - should return only new event
      const thirdPollRequest = createGetRequest(
        `http://localhost:3000/api/mock/pusher/events?channel=task-123&lastEventId=${lastEventId}`
      );
      const thirdPoll = await eventsGET(thirdPollRequest);
      const thirdResult = await thirdPoll.json();
      expect(thirdResult.events).toHaveLength(1);
      expect(thirdResult.events[0].eventName).toBe("event-2");
    });
  });

  describe("Event queue limits", () => {
    it("enforces max events per channel", async () => {
      // Trigger 150 events
      for (let i = 0; i < 150; i++) {
        const request = createPostRequest(
          "http://localhost:3000/api/mock/pusher/trigger",
          {
            channels: "task-123",
            event: `event-${i}`,
            data: { index: i },
          }
        );
        await triggerPOST(request);
      }

      const events = mockPusherState.getEvents("task-123");
      expect(events.length).toBeLessThanOrEqual(100);
      expect(events[events.length - 1].eventName).toBe("event-149");
    });
  });
});
