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
    // Reset mocks before each test
    vi.clearAllMocks();

    // Reset environment variables to a clean state
    process.env = {
      ...originalEnv,
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
    it("should create a Pusher instance with correct configuration", async () => {
      // Re-import after environment setup
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");

      expect(Pusher).toHaveBeenCalledWith({
        appId: "test-app-id",
        key: "test-key",
        secret: "test-secret",
        cluster: "test-cluster",
        useTLS: true,
      });

      expect(testPusherServer).toBeDefined();
      expect(testPusherServer.config).toEqual({
        appId: "test-app-id",
        key: "test-key",
        secret: "test-secret",
        cluster: "test-cluster",
        useTLS: true,
      });
    });

    it("should have a trigger method", async () => {
      // Re-import after environment setup
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");

      expect(testPusherServer.trigger).toBeDefined();
      expect(typeof testPusherServer.trigger).toBe("function");
    });

    it("should use environment variables for configuration", async () => {
      // Set different environment variables
      process.env.PUSHER_APP_ID = "different-app-id";
      process.env.PUSHER_KEY = "different-key";
      process.env.PUSHER_SECRET = "different-secret";
      process.env.PUSHER_CLUSTER = "different-cluster";

      // Clear the module cache and re-import
      vi.resetModules();
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");

      expect(Pusher).toHaveBeenCalledWith({
        appId: "different-app-id",
        key: "different-key",
        secret: "different-secret",
        cluster: "different-cluster",
        useTLS: true,
      });
    });
  });

  describe("getPusherClient", () => {
    beforeEach(() => {
      // Clear modules to reset the internal _pusherClient variable
      vi.resetModules();
    });

    it("should create a PusherClient instance with correct configuration", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      const client = testGetPusherClient();

      expect(PusherClient).toHaveBeenCalledWith("test-public-key", {
        cluster: "test-public-cluster",
      });

      expect(client).toBeDefined();
      expect(client.key).toBe("test-public-key");
      expect(client.options).toEqual({ cluster: "test-public-cluster" });
    });

    it("should implement lazy initialization (singleton pattern)", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      const client1 = testGetPusherClient();
      const client2 = testGetPusherClient();

      // Should only create one instance
      expect(PusherClient).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);
    });

    it("should throw error when NEXT_PUBLIC_PUSHER_KEY is missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      vi.resetModules();

      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      expect(() => testGetPusherClient()).toThrow("Pusher environment variables are not configured");
    });

    it("should throw error when NEXT_PUBLIC_PUSHER_CLUSTER is missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      vi.resetModules();

      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      expect(() => testGetPusherClient()).toThrow("Pusher environment variables are not configured");
    });

    it("should throw error when both environment variables are missing", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      vi.resetModules();

      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      expect(() => testGetPusherClient()).toThrow("Pusher environment variables are not configured");
    });

    it("should work with empty string environment variables", async () => {
      process.env.NEXT_PUBLIC_PUSHER_KEY = "";
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER = "test-cluster";
      vi.resetModules();

      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");

      expect(() => testGetPusherClient()).toThrow("Pusher environment variables are not configured");
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
