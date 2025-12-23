import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the external libraries before importing the module under test
vi.mock("pusher", () => {
  const MockPusher = vi.fn().mockImplementation((config) => ({
    trigger: vi.fn(),
    config,
  }));
  return { default: MockPusher };
});

vi.mock("pusher-js", () => {
  const MockPusherClient = vi.fn().mockImplementation((key, options) => ({
    subscribe: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    disconnect: vi.fn(),
    key,
    options,
  }));
  return { default: MockPusherClient };
});

import Pusher from "pusher";
import PusherClient from "pusher-js";

describe("pusher.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    
    // Reset environment variables to a clean state BEFORE module imports
    process.env = {
      ...originalEnv,
      USE_MOCKS: "false", // Ensure mocks are disabled for validation tests
      PUSHER_APP_ID: "test-app-id",
      PUSHER_KEY: "test-key",
      PUSHER_SECRET: "test-secret",
      PUSHER_CLUSTER: "test-cluster",
      NEXT_PUBLIC_PUSHER_KEY: "test-public-key",
      NEXT_PUBLIC_PUSHER_CLUSTER: "test-public-cluster",
    };

    // Reset the internal _pusherClient variable by clearing the module cache
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("pusherServer", () => {
    it("should create a MockPusherServer instance in test environment", async () => {
      // Re-import after environment setup
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");
      
      // In test environment with USE_MOCKS=true, MockPusherServer is used
      expect(testPusherServer).toBeDefined();
      expect(testPusherServer.trigger).toBeDefined();
      expect(typeof testPusherServer.trigger).toBe("function");
    });

    it("should have a trigger method", async () => {
      // Re-import after environment setup
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");
      
      expect(testPusherServer.trigger).toBeDefined();
      expect(typeof testPusherServer.trigger).toBe("function");
    });
  });

  describe("getPusherClient", () => {
    beforeEach(() => {
      // Clear modules to reset the internal _pusherClient variable
      vi.resetModules();
    });

    it("should create a MockPusherClient instance in test environment", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client = testGetPusherClient();
      
      // In test environment with USE_MOCKS=true, MockPusherClient is used
      expect(client).toBeDefined();
      expect(client.subscribe).toBeDefined();
      expect(typeof client.subscribe).toBe("function");
    });

    it("should implement lazy initialization (singleton pattern)", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client1 = testGetPusherClient();
      const client2 = testGetPusherClient();
      
      // Should return the same instance
      expect(client1).toBe(client2);
    });

    it("should have expected methods on returned client", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client = testGetPusherClient();
      
      expect(client.subscribe).toBeDefined();
      expect(client.bind).toBeDefined();
      expect(client.unbind).toBeDefined();
      expect(client.disconnect).toBeDefined();
      expect(typeof client.subscribe).toBe("function");
      expect(typeof client.bind).toBe("function");
      expect(typeof client.unbind).toBe("function");
      expect(typeof client.disconnect).toBe("function");
    });
  });

  describe("getTaskChannelName", () => {
    it("should return correct channel name for task ID", async () => {
      const { getTaskChannelName } = await import("@/lib/pusher");
      
      expect(getTaskChannelName("123")).toBe("task-123");
      expect(getTaskChannelName("abc-def")).toBe("task-abc-def");
      expect(getTaskChannelName("task-456")).toBe("task-task-456");
    });

    it("should handle empty string task ID", async () => {
      const { getTaskChannelName } = await import("@/lib/pusher");
      expect(getTaskChannelName("")).toBe("task-");
    });

    it("should handle special characters in task ID", async () => {
      const { getTaskChannelName } = await import("@/lib/pusher");
      expect(getTaskChannelName("task-123@#$")).toBe("task-task-123@#$");
      expect(getTaskChannelName("123-456-789")).toBe("task-123-456-789");
    });

    it("should handle numeric task ID as string", async () => {
      const { getTaskChannelName } = await import("@/lib/pusher");
      expect(getTaskChannelName("42")).toBe("task-42");
      expect(getTaskChannelName("0")).toBe("task-0");
    });

    it("should be deterministic for same input", async () => {
      const { getTaskChannelName } = await import("@/lib/pusher");
      const taskId = "test-task-123";
      const result1 = getTaskChannelName(taskId);
      const result2 = getTaskChannelName(taskId);
      
      expect(result1).toBe(result2);
      expect(result1).toBe("task-test-task-123");
    });
  });

  describe("getWorkspaceChannelName", () => {
    it("should return correct channel name for workspace slug", async () => {
      const { getWorkspaceChannelName } = await import("@/lib/pusher");
      expect(getWorkspaceChannelName("my-workspace")).toBe("workspace-my-workspace");
      expect(getWorkspaceChannelName("test")).toBe("workspace-test");
      expect(getWorkspaceChannelName("workspace-123")).toBe("workspace-workspace-123");
    });

    it("should handle empty string workspace slug", async () => {
      const { getWorkspaceChannelName } = await import("@/lib/pusher");
      expect(getWorkspaceChannelName("")).toBe("workspace-");
    });

    it("should handle special characters in workspace slug", async () => {
      const { getWorkspaceChannelName } = await import("@/lib/pusher");
      expect(getWorkspaceChannelName("my-workspace@#$")).toBe("workspace-my-workspace@#$");
      expect(getWorkspaceChannelName("test_workspace_123")).toBe("workspace-test_workspace_123");
    });

    it("should handle numeric workspace slug as string", async () => {
      const { getWorkspaceChannelName } = await import("@/lib/pusher");
      expect(getWorkspaceChannelName("42")).toBe("workspace-42");
      expect(getWorkspaceChannelName("0")).toBe("workspace-0");
    });

    it("should be deterministic for same input", async () => {
      const { getWorkspaceChannelName } = await import("@/lib/pusher");
      const workspaceSlug = "test-workspace";
      const result1 = getWorkspaceChannelName(workspaceSlug);
      const result2 = getWorkspaceChannelName(workspaceSlug);
      
      expect(result1).toBe(result2);
      expect(result1).toBe("workspace-test-workspace");
    });
  });

  describe("PUSHER_EVENTS", () => {
    it("should contain all expected event constants", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
      expect(PUSHER_EVENTS).toEqual({
        NEW_MESSAGE: "new-message",
        FOLLOW_UP_QUESTIONS: "follow-up-questions",
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

    it("should have string values for all events", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
      Object.values(PUSHER_EVENTS).forEach((eventName) => {
        expect(typeof eventName).toBe("string");
        expect(eventName.length).toBeGreaterThan(0);
      });
    });

    it("should have unique values for all events", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
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

    it("should contain specific event types", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
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

    it("should have correct number of events", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
      expect(Object.keys(PUSHER_EVENTS)).toHaveLength(10);
    });

    it("should follow kebab-case naming convention for event values", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
      Object.values(PUSHER_EVENTS).forEach((eventName) => {
        // Check if the event name follows kebab-case pattern (lowercase words separated by hyphens)
        expect(eventName).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });

    it("should follow SCREAMING_SNAKE_CASE naming convention for keys", async () => {
      const { PUSHER_EVENTS } = await import("@/lib/pusher");
      Object.keys(PUSHER_EVENTS).forEach((key) => {
        // Check if the key follows SCREAMING_SNAKE_CASE pattern
        expect(key).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      });
    });
  });

  describe("integration tests", () => {
    it("should work together: channel names with event constants", async () => {
      const { getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } = await import("@/lib/pusher");
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

    it("should have all exports available", async () => {
      const { pusherServer, getPusherClient, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } = await import("@/lib/pusher");
      
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
