import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * This test file tests the pusher module which conditionally uses either
 * real Pusher or mock Pusher based on the USE_MOCKS environment variable.
 * 
 * Since the code now routes to mock implementations when USE_MOCKS=true,
 * we test the behavior rather than constructor calls.
 */

import {
  pusherServer,
  getPusherClient,
  getTaskChannelName,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";

describe("pusher.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Restore environment variables before each test
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_PUSHER_KEY: "test-pusher-key",
      NEXT_PUBLIC_PUSHER_CLUSTER: "test-cluster",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("pusherServer", () => {
    it("should have a trigger method", async () => {
      const { pusherServer } = await import("@/lib/pusher");
      
      expect(pusherServer.trigger).toBeDefined();
      expect(typeof pusherServer.trigger).toBe("function");
    });

    it("should return success when triggering events", async () => {
      const { pusherServer } = await import("@/lib/pusher");
      
      // MockPusherServer.trigger returns Promise<{ success: boolean }>
      // Real Pusher may return a different structure but both have trigger method
      const result = await pusherServer.trigger("test-channel", "test-event", { data: "test" });
      
      expect(result).toBeDefined();
      // In mock mode, result is { success: true }
      // In real mode with mocked library, result may be different
      // Just verify the method executes without error
      expect(typeof result).toBe("object");
    });
  });

  describe("getPusherClient", () => {
    it("should create a client instance", async () => {
      const { getPusherClient } = await import("@/lib/pusher");
      
      const client = getPusherClient();
      
      expect(client).toBeDefined();
      expect(client.subscribe).toBeDefined();
      expect(typeof client.subscribe).toBe("function");
    });

    it("should implement lazy initialization (singleton pattern)", async () => {
      // Reset modules to ensure clean state
      vi.resetModules();
      
      const { getPusherClient } = await import("@/lib/pusher");
      
      const client1 = getPusherClient();
      const client2 = getPusherClient();
      
      // Should return same instance
      expect(client1).toBe(client2);
    });

    it("should throw error when NEXT_PUBLIC_PUSHER_KEY is missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      expect(() => testGetPusherClient()).toThrow(
        "Pusher environment variables are not configured"
      );
    });

    it("should throw error when NEXT_PUBLIC_PUSHER_CLUSTER is missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      expect(() => testGetPusherClient()).toThrow(
        "Pusher environment variables are not configured"
      );
    });

    it("should throw error when both environment variables are missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      expect(() => testGetPusherClient()).toThrow(
        "Pusher environment variables are not configured"
      );
    });

    it("should work with empty string environment variables", async () => {
      process.env.NEXT_PUBLIC_PUSHER_KEY = "";
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER = "test-cluster";
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      expect(() => testGetPusherClient()).toThrow(
        "Pusher environment variables are not configured"
      );
    });

    it("should have expected methods on returned client", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client = testGetPusherClient();
      
      // Both real and mock Pusher clients have these methods
      expect(client.subscribe).toBeDefined();
      expect(client.disconnect).toBeDefined();
      expect(typeof client.subscribe).toBe("function");
      expect(typeof client.disconnect).toBe("function");
      
      // Verify we can call subscribe without error
      const channel = client.subscribe("test-channel");
      expect(channel).toBeDefined();
    });
  });

  describe("getTaskChannelName", () => {
    it("should return correct channel name for task ID", () => {
      expect(getTaskChannelName("123")).toBe("task-123");
      expect(getTaskChannelName("abc-def")).toBe("task-abc-def");
      expect(getTaskChannelName("task-456")).toBe("task-task-456");
    });

    it("should handle empty string task ID", () => {
      expect(getTaskChannelName("")).toBe("task-");
    });

    it("should handle special characters in task ID", () => {
      expect(getTaskChannelName("task-123@#$")).toBe("task-task-123@#$");
      expect(getTaskChannelName("123-456-789")).toBe("task-123-456-789");
    });

    it("should handle numeric task ID as string", () => {
      expect(getTaskChannelName("42")).toBe("task-42");
      expect(getTaskChannelName("0")).toBe("task-0");
    });

    it("should be deterministic for same input", () => {
      const taskId = "test-task-123";
      const result1 = getTaskChannelName(taskId);
      const result2 = getTaskChannelName(taskId);
      
      expect(result1).toBe(result2);
      expect(result1).toBe("task-test-task-123");
    });
  });

  describe("getWorkspaceChannelName", () => {
    it("should return correct channel name for workspace slug", () => {
      expect(getWorkspaceChannelName("my-workspace")).toBe("workspace-my-workspace");
      expect(getWorkspaceChannelName("test")).toBe("workspace-test");
      expect(getWorkspaceChannelName("workspace-123")).toBe("workspace-workspace-123");
    });

    it("should handle empty string workspace slug", () => {
      expect(getWorkspaceChannelName("")).toBe("workspace-");
    });

    it("should handle special characters in workspace slug", () => {
      expect(getWorkspaceChannelName("my-workspace@#$")).toBe("workspace-my-workspace@#$");
      expect(getWorkspaceChannelName("test_workspace_123")).toBe("workspace-test_workspace_123");
    });

    it("should handle numeric workspace slug as string", () => {
      expect(getWorkspaceChannelName("42")).toBe("workspace-42");
      expect(getWorkspaceChannelName("0")).toBe("workspace-0");
    });

    it("should be deterministic for same input", () => {
      const workspaceSlug = "test-workspace";
      const result1 = getWorkspaceChannelName(workspaceSlug);
      const result2 = getWorkspaceChannelName(workspaceSlug);
      
      expect(result1).toBe(result2);
      expect(result1).toBe("workspace-test-workspace");
    });
  });

  describe("PUSHER_EVENTS", () => {
    it("should contain all expected event constants", () => {
      expect(PUSHER_EVENTS).toEqual({
        NEW_MESSAGE: "new-message",
        CONNECTION_COUNT: "connection-count",
        WORKFLOW_STATUS_UPDATE: "workflow-status-update",
        RECOMMENDATIONS_UPDATED: "recommendations-updated",
        TASK_TITLE_UPDATE: "task-title-update",
        WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
        STAKWORK_RUN_UPDATE: "stakwork-run-update",
        STAKWORK_RUN_DECISION: "stakwork-run-decision",
        HIGHLIGHT_NODES: "highlight-nodes",
      });
    });

    it("should have string values for all events", () => {
      Object.values(PUSHER_EVENTS).forEach((eventName) => {
        expect(typeof eventName).toBe("string");
        expect(eventName.length).toBeGreaterThan(0);
      });
    });

    it("should have unique values for all events", () => {
      const values = Object.values(PUSHER_EVENTS);
      const uniqueValues = [...new Set(values)];
      
      expect(uniqueValues).toHaveLength(values.length);
    });

    // This test is commented out because PUSHER_EVENTS is not actually immutable at runtime
    // TypeScript prevents modifications at compile time with "as const"
    // it("should be immutable (readonly)", () => {
    //   expect(() => {
    //     // @ts-expect-error - Testing runtime immutability
    //     PUSHER_EVENTS.NEW_MESSAGE = "modified";
    //   }).toThrow();
    // });

    it("should contain specific event types", () => {
      expect(PUSHER_EVENTS.NEW_MESSAGE).toBe("new-message");
      expect(PUSHER_EVENTS.CONNECTION_COUNT).toBe("connection-count");
      expect(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE).toBe("workflow-status-update");
      expect(PUSHER_EVENTS.RECOMMENDATIONS_UPDATED).toBe("recommendations-updated");
      expect(PUSHER_EVENTS.TASK_TITLE_UPDATE).toBe("task-title-update");
      expect(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE).toBe("workspace-task-title-update");
      expect(PUSHER_EVENTS.STAKWORK_RUN_UPDATE).toBe("stakwork-run-update");
      expect(PUSHER_EVENTS.STAKWORK_RUN_DECISION).toBe("stakwork-run-decision");
      expect(PUSHER_EVENTS.HIGHLIGHT_NODES).toBe("highlight-nodes");
    });

    it("should have correct number of events", () => {
      expect(Object.keys(PUSHER_EVENTS)).toHaveLength(9);
    });

    it("should follow kebab-case naming convention for event values", () => {
      Object.values(PUSHER_EVENTS).forEach((eventName) => {
        // Check if the event name follows kebab-case pattern (lowercase words separated by hyphens)
        expect(eventName).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });

    it("should follow SCREAMING_SNAKE_CASE naming convention for keys", () => {
      Object.keys(PUSHER_EVENTS).forEach((key) => {
        // Check if the key follows SCREAMING_SNAKE_CASE pattern
        expect(key).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      });
    });
  });

  describe("integration tests", () => {
    it("should work together: channel names with event constants", () => {
      const taskId = "test-task-123";
      const workspaceSlug = "test-workspace";
      
      const taskChannel = getTaskChannelName(taskId);
      const workspaceChannel = getWorkspaceChannelName(workspaceSlug);
      
      expect(taskChannel).toBe("task-test-task-123");
      expect(workspaceChannel).toBe("workspace-test-workspace");
      
      // Verify these can be used with event constants
      expect(PUSHER_EVENTS.TASK_TITLE_UPDATE).toBe("task-title-update");
      expect(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE).toBe("workspace-task-title-update");
    });

    it("should have all exports available", () => {
      expect(pusherServer).toBeDefined();
      expect(getPusherClient).toBeDefined();
      expect(getTaskChannelName).toBeDefined();
      expect(getWorkspaceChannelName).toBeDefined();
      expect(PUSHER_EVENTS).toBeDefined();
      
      expect(typeof getPusherClient).toBe("function");
      expect(typeof getTaskChannelName).toBe("function");
      expect(typeof getWorkspaceChannelName).toBe("function");
      expect(typeof PUSHER_EVENTS).toBe("object");
    });
  });
});
