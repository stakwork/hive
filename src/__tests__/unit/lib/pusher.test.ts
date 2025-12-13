import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config/env before importing pusher
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    getPusherConfig: vi.fn(() => ({
      appId: process.env.USE_MOCKS === "true" ? "mock-app-id" : process.env.PUSHER_APP_ID || "test-app-id",
      key: process.env.USE_MOCKS === "true" ? "mock-key" : process.env.PUSHER_KEY || "test-key",
      secret: process.env.USE_MOCKS === "true" ? "mock-secret" : process.env.PUSHER_SECRET || "test-secret",
      cluster: process.env.USE_MOCKS === "true" ? "mock-cluster" : process.env.PUSHER_CLUSTER || "test-cluster",
      useTLS: true,
    })),
    getPusherClientConfig: vi.fn(() => {
      if (process.env.USE_MOCKS === "true") {
        return {
          key: "mock-pusher-key",
          cluster: "mock-cluster",
        };
      }
      
      // Throw if env vars are missing (matching real behavior)
      if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
        throw new Error("Pusher environment variables are not configured");
      }
      
      return {
        key: process.env.NEXT_PUBLIC_PUSHER_KEY,
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
      };
    }),
    // Make config a getter that returns current env state
    get config() {
      return {
        USE_MOCKS: process.env.USE_MOCKS === "true",
        MOCK_BASE: process.env.NEXTAUTH_URL || "http://localhost:3000",
      };
    },
  };
});

// Mock the external libraries before importing the module under test
vi.mock("pusher", () => {
  const MockPusher = vi.fn().mockImplementation((config) => ({
    trigger: vi.fn(),
    triggerBatch: vi.fn(),
    authenticate: vi.fn(),
    authorizeChannel: vi.fn(),
    webhook: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
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

// Mock the mock client wrapper
vi.mock("@/lib/mock/pusher-client-wrapper", () => {
  const MockPusherClientWrapper = vi.fn().mockImplementation((key, options) => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    channel: vi.fn(),
    disconnect: vi.fn(),
    allChannels: vi.fn(() => []),
    key,
    options,
  }));
  return { MockPusherClient: MockPusherClientWrapper };
});

import Pusher from "pusher";
import PusherClient from "pusher-js";
import { MockPusherClient } from "@/lib/mock/pusher-client-wrapper";
import {
  pusherServer,
  getPusherClient,
  getTaskChannelName,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";

describe("pusher.ts", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    
    // Mock fetch for server-side trigger in mock mode
    global.fetch = vi.fn();
    
    // Reset environment variables to a clean state
    process.env = {
      ...originalEnv,
      USE_MOCKS: "false", // Default to real Pusher for most tests
      NEXTAUTH_URL: "http://localhost:3000",
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
    global.fetch = originalFetch;
  });

  describe("pusherServer", () => {
    it("should create a Pusher instance with correct configuration when USE_MOCKS=false", async () => {
      // Re-import after environment setup
      await import("@/lib/pusher");
      
      expect(Pusher).toHaveBeenCalledWith({
        appId: "test-app-id",
        key: "test-key",
        secret: "test-secret",
        cluster: "test-cluster",
        useTLS: true,
      });
    });

    it("should use mock config when USE_MOCKS=true", async () => {
      process.env.USE_MOCKS = "true";
      vi.resetModules();
      
      await import("@/lib/pusher");
      
      expect(Pusher).toHaveBeenCalledWith({
        appId: "mock-app-id",
        key: "mock-key",
        secret: "mock-secret",
        cluster: "mock-cluster",
        useTLS: true,
      });
    });

    it("should call real Pusher trigger when USE_MOCKS=false", async () => {
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");
      
      await testPusherServer.trigger("test-channel", "test-event", { foo: "bar" });
      
      // Should call the real Pusher instance trigger
      const pusherInstance = (Pusher as any).mock.results[0].value;
      expect(pusherInstance.trigger).toHaveBeenCalledWith(
        "test-channel",
        "test-event",
        { foo: "bar" },
        undefined
      );
    });

    it("should call mock endpoint when USE_MOCKS=true", async () => {
      process.env.USE_MOCKS = "true";
      vi.resetModules();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ event_ids: { "test-channel": "evt_123" } }),
      });
      
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");
      
      await testPusherServer.trigger("test-channel", "test-event", { foo: "bar" });
      
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/pusher/trigger",
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: "test-channel",
            event: "test-event",
            data: { foo: "bar" },
          }),
        }
      );
    });

    it("should have passthrough methods", async () => {
      const { pusherServer: testPusherServer } = await import("@/lib/pusher");
      
      expect(testPusherServer.triggerBatch).toBeDefined();
      expect(testPusherServer.authenticate).toBeDefined();
      expect(testPusherServer.authorizeChannel).toBeDefined();
      expect(testPusherServer.webhook).toBeDefined();
      expect(testPusherServer.get).toBeDefined();
      expect(testPusherServer.post).toBeDefined();
    });
  });

  describe("getPusherClient", () => {
    beforeEach(() => {
      // Clear modules to reset the internal _pusherClient variable
      vi.resetModules();
    });

    it("should create a PusherClient instance when USE_MOCKS=false", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client = testGetPusherClient();
      
      // When USE_MOCKS=false, should call real PusherClient
      expect(PusherClient).toHaveBeenCalledWith("test-public-key", {
        cluster: "test-public-cluster",
      });
      
      expect(client).toBeDefined();
    });

    it("should create a MockPusherClient instance when USE_MOCKS=true", async () => {
      process.env.USE_MOCKS = "true";
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client = testGetPusherClient();
      
      // When USE_MOCKS=true, should call MockPusherClient
      expect(MockPusherClient).toHaveBeenCalledWith("mock-pusher-key", {
        cluster: "mock-cluster",
        pollingInterval: 1000,
      });
      
      expect(client).toBeDefined();
    });

    it("should implement lazy initialization (singleton pattern)", async () => {
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      const client1 = testGetPusherClient();
      const client2 = testGetPusherClient();
      
      // Should only create one instance (either PusherClient or MockPusherClient)
      // In this case USE_MOCKS=false, so PusherClient is called
      expect(PusherClient).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);
    });

    it("should throw error when NEXT_PUBLIC_PUSHER_KEY is missing and USE_MOCKS=false", async () => {
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      // getPusherClientConfig will throw, which will be caught when calling getPusherClient
      expect(() => testGetPusherClient()).toThrow(
        "Pusher environment variables are not configured"
      );
    });

    it("should NOT throw error when env vars missing but USE_MOCKS=true", async () => {
      process.env.USE_MOCKS = "true";
      delete process.env.NEXT_PUBLIC_PUSHER_KEY;
      delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
      vi.resetModules();
      
      const { getPusherClient: testGetPusherClient } = await import("@/lib/pusher");
      
      // Should not throw, should return mock client
      expect(() => testGetPusherClient()).not.toThrow();
      // Should call MockPusherClient since USE_MOCKS=true
      expect(MockPusherClient).toHaveBeenCalled();
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
