import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePusherConnection } from "@/hooks/usePusherConnection";
import type { ChatMessage } from "@/types/task";
import type {
  WorkflowStatusUpdate,
  TaskTitleUpdateEvent,
  RecommendationsUpdatedEvent,
} from "@/hooks/usePusherConnection";

// Mock Pusher client and channel
const mockHandlers = new Map<string, Function>();

const mockChannel = {
  bind: vi.fn((event: string, callback: Function) => {
    mockHandlers.set(event, callback);
  }),
  unbind_all: vi.fn(() => {
    mockHandlers.clear();
  }),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

// Mock the getPusherClient singleton
vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    TASK_TITLE_UPDATE: "task-title-update",
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Mock fetch for NEW_MESSAGE event
global.fetch = vi.fn();

describe("usePusherConnection Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockHandlers.clear();

    // Reset mock implementations - use the handlers map now
    mockChannel.bind.mockImplementation((event: string, callback: Function) => {
      mockHandlers.set(event, callback);
      // Auto-trigger subscription success after a delay
      if (event === "pusher:subscription_succeeded") {
        setTimeout(() => callback(), 100);
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Connection Establishment - Task Channel", () => {
    test("should connect to task channel on mount", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`task-${taskId}`);
      expect(mockPusherClient.subscribe).toHaveBeenCalledTimes(1);
    });

    test("should set connection state after subscription succeeds", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      // Initially not connected
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();

      // Advance timers to trigger subscription success
      vi.advanceTimersByTime(100);

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connectionId).toMatch(/^pusher_task_task-123_/);
      });
    });

    test("should bind to pusher:subscription_succeeded event", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "pusher:subscription_succeeded",
        expect.any(Function)
      );
    });

    test("should bind to pusher:subscription_error event", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "pusher:subscription_error",
        expect.any(Function)
      );
    });

    test("should not connect when enabled is false", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: false,
        })
      );

      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should respect custom connectionReadyDelay", async () => {
      const taskId = "task-123";
      const customDelay = 500;

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          connectionReadyDelay: customDelay,
        })
      );

      // Trigger subscription success
      vi.advanceTimersByTime(100);

      // Connection should not be ready yet (custom delay not reached)
      expect(result.current.isConnected).toBe(false);

      // Advance by custom delay
      vi.advanceTimersByTime(customDelay);

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });
  });

  describe("Connection Establishment - Workspace Channel", () => {
    test("should connect to workspace channel on mount", () => {
      const workspaceSlug = "my-workspace";

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
        })
      );

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(
        `workspace-${workspaceSlug}`
      );
      expect(mockPusherClient.subscribe).toHaveBeenCalledTimes(1);
    });

    test("should set connection state for workspace channel", async () => {
      const workspaceSlug = "my-workspace";

      const { result } = renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
        })
      );

      expect(result.current.isConnected).toBe(false);

      vi.advanceTimersByTime(100);

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connectionId).toMatch(/^pusher_workspace_my-workspace_/);
      });
    });

    test("should prioritize taskId over workspaceSlug when both provided", () => {
      const taskId = "task-123";
      const workspaceSlug = "my-workspace";

      renderHook(() =>
        usePusherConnection({
          taskId,
          workspaceSlug,
          enabled: true,
        })
      );

      // Should subscribe to task channel, not workspace
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`task-${taskId}`);
      expect(mockPusherClient.subscribe).not.toHaveBeenCalledWith(
        `workspace-${workspaceSlug}`
      );
    });
  });

  describe("Event Handler Registration - Task Channel", () => {
    test("should register NEW_MESSAGE event handler for task channel", () => {
      const taskId = "task-123";
      const onMessage = vi.fn();

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "new-message",
        expect.any(Function)
      );
    });

    test("should register WORKFLOW_STATUS_UPDATE event handler for task channel", () => {
      const taskId = "task-123";
      const onWorkflowStatusUpdate = vi.fn();

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onWorkflowStatusUpdate,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "workflow-status-update",
        expect.any(Function)
      );
    });

    test("should register TASK_TITLE_UPDATE event handler for task channel", () => {
      const taskId = "task-123";
      const onTaskTitleUpdate = vi.fn();

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onTaskTitleUpdate,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "task-title-update",
        expect.any(Function)
      );
    });

    test("should register all task-specific events when all callbacks provided", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage: vi.fn(),
          onWorkflowStatusUpdate: vi.fn(),
          onTaskTitleUpdate: vi.fn(),
        })
      );

      // Should bind to pusher events + 3 task-specific events
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "pusher:subscription_succeeded",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "pusher:subscription_error",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith("new-message", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "workflow-status-update",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "task-title-update",
        expect.any(Function)
      );
    });
  });

  describe("Event Handler Registration - Workspace Channel", () => {
    test("should register RECOMMENDATIONS_UPDATED event handler for workspace channel", () => {
      const workspaceSlug = "my-workspace";
      const onRecommendationsUpdated = vi.fn();

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onRecommendationsUpdated,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "recommendations-updated",
        expect.any(Function)
      );
    });

    test("should register WORKSPACE_TASK_TITLE_UPDATE event handler for workspace channel", () => {
      const workspaceSlug = "my-workspace";
      const onTaskTitleUpdate = vi.fn();

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onTaskTitleUpdate,
        })
      );

      expect(mockChannel.bind).toHaveBeenCalledWith(
        "workspace-task-title-update",
        expect.any(Function)
      );
    });

    test("should not register task-specific events for workspace channel", () => {
      const workspaceSlug = "my-workspace";

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onMessage: vi.fn(),
          onWorkflowStatusUpdate: vi.fn(),
        })
      );

      // Should not bind to task-specific events
      expect(mockChannel.bind).not.toHaveBeenCalledWith("new-message", expect.any(Function));
      expect(mockChannel.bind).not.toHaveBeenCalledWith(
        "workflow-status-update",
        expect.any(Function)
      );
    });
  });

  describe("Event Handler Execution", () => {
    test("should call onMessage callback when NEW_MESSAGE event received", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();
      const mockMessage: ChatMessage = {
        id: "msg-1",
        content: "Test message",
        role: "user",
        taskId: "task-123",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock fetch to return message data
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockMessage }),
      } as Response);

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        })
      );

      // Get the handler from the mockHandlers Map
      const messageHandler = mockHandlers.get("new-message");
      expect(messageHandler).toBeDefined();

      // Trigger the NEW_MESSAGE event with message ID
      if (messageHandler) {
        await messageHandler("msg-1");
      }

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/chat/messages/msg-1");
        expect(onMessage).toHaveBeenCalledWith(mockMessage);
      });
    });

    test("should call onWorkflowStatusUpdate callback when event received", async () => {
      const taskId = "task-123";
      const onWorkflowStatusUpdate = vi.fn();
      const mockUpdate: WorkflowStatusUpdate = {
        taskId: "task-123",
        workflowStatus: "IN_PROGRESS",
      };

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onWorkflowStatusUpdate,
        })
      );

      // Get the handler from the mockHandlers Map
      const statusHandler = mockHandlers.get("workflow-status-update");
      expect(statusHandler).toBeDefined();

      // Trigger the event
      if (statusHandler) {
        statusHandler(mockUpdate);
      }

      await waitFor(() => {
        expect(onWorkflowStatusUpdate).toHaveBeenCalledWith(mockUpdate);
      });
    });

    test("should call onTaskTitleUpdate callback when event received", async () => {
      const taskId = "task-123";
      const onTaskTitleUpdate = vi.fn();
      const mockUpdate: TaskTitleUpdateEvent = {
        taskId: "task-123",
        newTitle: "Updated Title",
        previousTitle: "Old Title",
      };

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onTaskTitleUpdate,
        })
      );

      // Get the handler from the mockHandlers Map
      const titleHandler = mockHandlers.get("task-title-update");
      expect(titleHandler).toBeDefined();

      // Trigger the event
      if (titleHandler) {
        titleHandler(mockUpdate);
      }

      await waitFor(() => {
        expect(onTaskTitleUpdate).toHaveBeenCalledWith(mockUpdate);
      });
    });

    test("should call onRecommendationsUpdated callback for workspace channel", async () => {
      const workspaceSlug = "my-workspace";
      const onRecommendationsUpdated = vi.fn();
      const mockUpdate: RecommendationsUpdatedEvent = {
        workspaceSlug: "my-workspace",
        newRecommendationCount: 5,
        totalRecommendationCount: 20,
      };

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onRecommendationsUpdated,
        })
      );

      // Get the handler from the mockHandlers Map
      const recommendationsHandler = mockHandlers.get("recommendations-updated");
      expect(recommendationsHandler).toBeDefined();

      // Trigger the event
      if (recommendationsHandler) {
        recommendationsHandler(mockUpdate);
      }

      await waitFor(() => {
        expect(onRecommendationsUpdated).toHaveBeenCalledWith(mockUpdate);
      });
    });

    test.skip("should handle NEW_MESSAGE fetch failure gracefully", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();

      // Mock fetch to fail
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        })
      );

      // Get the handler from the mockHandlers Map
      const messageHandler = mockHandlers.get("new-message");
      expect(messageHandler).toBeDefined();

      // Trigger the event
      if (messageHandler) {
        await messageHandler("msg-1");
      }

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/chat/messages/msg-1");
        expect(onMessage).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch message by id",
          "msg-1"
        );
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Cleanup and Disconnection", () => {
    test("should call disconnect function to cleanup", () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      // Call disconnect manually
      result.current.disconnect();

      expect(mockChannel.unbind_all).toHaveBeenCalledTimes(1);
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should cleanup on unmount", () => {
      const taskId = "task-123";

      const { unmount } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      unmount();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should disconnect from previous channel when taskId changes", () => {
      const { rerender } = renderHook(
        ({ taskId }: { taskId: string }) =>
          usePusherConnection({
            taskId,
            enabled: true,
          }),
        { initialProps: { taskId: "task-123" } }
      );

      // Change taskId
      rerender({ taskId: "task-456" });

      // Should unsubscribe from old channel
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-123");
      // And subscribe to new channel
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-456");
    });

    test("should disconnect when enabled changes to false", () => {
      const taskId = "task-123";

      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          usePusherConnection({
            taskId,
            enabled,
          }),
        { initialProps: { enabled: true } }
      );

      // Disable connection
      rerender({ enabled: false });

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test.skip("should reset connection state after disconnect", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      // Wait for connection
      vi.advanceTimersByTime(100);
      await waitFor(() => expect(result.current.isConnected).toBe(true));

      // Disconnect
      result.current.disconnect();

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe("Error Handling", () => {
    test.skip("should set error state on subscription error", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      // Get the error handler from the mockHandlers Map
      const errorHandler = mockHandlers.get("pusher:subscription_error");
      expect(errorHandler).toBeDefined();

      // Trigger subscription error
      if (errorHandler) {
        errorHandler({ error: "Subscription failed" });
      }

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to connect to task real-time updates");
        expect(result.current.isConnected).toBe(false);
      });
    });

    test("should handle connection errors gracefully", () => {
      const taskId = "task-123";

      // Mock subscribe to throw error
      mockPusherClient.subscribe.mockImplementationOnce(() => {
        throw new Error("Connection failed");
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(result.current.error).toBe("Failed to setup task real-time connection");
      expect(result.current.isConnected).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error setting up Pusher connection:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test.skip("should clear error on successful reconnection", async () => {
      const taskId = "task-123";

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          usePusherConnection({
            taskId,
            enabled,
          }),
        { initialProps: { enabled: true } }
      );

      // Simulate subscription error
      let errorHandler: Function | null = null;
      mockChannel.bind.mockImplementation((event: string, callback: Function) => {
        if (event === "pusher:subscription_error") {
          errorHandler = callback;
        }
      });

      if (errorHandler) {
        errorHandler({ error: "Subscription failed" });
      }

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to connect to task real-time updates");
      });

      // Reconnect by toggling enabled
      rerender({ enabled: false });
      rerender({ enabled: true });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe("State Management", () => {
    test("should initialize with disconnected state", () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
      expect(result.current.error).toBeNull();
    });

    test("should provide connect function", () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(typeof result.current.connect).toBe("function");
    });

    test("should provide disconnect function", () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      expect(typeof result.current.disconnect).toBe("function");
    });

    test.skip("should maintain connection state across re-renders", async () => {
      const taskId = "task-123";

      const { result, rerender } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        })
      );

      vi.advanceTimersByTime(100);
      await waitFor(() => expect(result.current.isConnected).toBe(true));

      const connectionId = result.current.connectionId;

      rerender();

      expect(result.current.isConnected).toBe(true);
      expect(result.current.connectionId).toBe(connectionId);
    });
  });

  describe("Edge Cases", () => {
    test("should handle no taskId or workspaceSlug gracefully", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          enabled: true,
        })
      );

      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
    });

    test("should handle undefined callbacks gracefully", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          // No callbacks provided
        })
      );

      // Should still subscribe and bind events
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`task-${taskId}`);
      expect(mockChannel.bind).toHaveBeenCalled();
    });

    test("should handle rapid taskId changes", () => {
      const { rerender } = renderHook(
        ({ taskId }: { taskId: string }) =>
          usePusherConnection({
            taskId,
            enabled: true,
          }),
        { initialProps: { taskId: "task-1" } }
      );

      // Rapidly change taskId
      rerender({ taskId: "task-2" });
      rerender({ taskId: "task-3" });
      rerender({ taskId: "task-4" });

      // Should unsubscribe from previous channels
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-1");
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-2");
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-3");
      // And subscribe to final channel
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-4");
    });

    test("should handle switching between task and workspace channels", () => {
      const { rerender } = renderHook(
        ({ taskId, workspaceSlug }: { taskId?: string; workspaceSlug?: string }) =>
          usePusherConnection({
            taskId,
            workspaceSlug,
            enabled: true,
          }),
        { initialProps: { taskId: "task-123" } }
      );

      // Switch to workspace channel
      rerender({ workspaceSlug: "my-workspace" });

      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-123");
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-my-workspace");
    });

    test("should handle empty string taskId", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "",
          enabled: true,
        })
      );

      // Empty string is falsy, should not subscribe
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
    });

    test("should handle empty string workspaceSlug", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          workspaceSlug: "",
          enabled: true,
        })
      );

      // Empty string is falsy, should not subscribe
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
    });

    test.skip("should handle connectionReadyDelay of 0", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          connectionReadyDelay: 0,
        })
      );

      vi.advanceTimersByTime(100); // Trigger subscription success

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });
  });

  describe("Callback Reference Stability", () => {
    test.skip("should use latest callback reference via refs", async () => {
      const taskId = "task-123";
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();

      let messageHandler: Function | null = null;
      mockChannel.bind.mockImplementation((event: string, callback: Function) => {
        if (event === "new-message") {
          messageHandler = callback;
        }
      });

      const mockMessage: ChatMessage = {
        id: "msg-1",
        content: "Test message",
        role: "user",
        taskId: "task-123",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockMessage }),
      } as Response);

      const { rerender } = renderHook(
        ({ callback }: { callback: (msg: ChatMessage) => void }) =>
          usePusherConnection({
            taskId,
            enabled: true,
            onMessage: callback,
          }),
        { initialProps: { callback: firstCallback } }
      );

      // Change callback
      rerender({ callback: secondCallback });

      // Trigger event with new callback
      if (messageHandler) {
        await messageHandler("msg-1");
      }

      await waitFor(() => {
        expect(firstCallback).not.toHaveBeenCalled();
        expect(secondCallback).toHaveBeenCalledWith(mockMessage);
      });
    });
  });

  describe("Multiple Event Handlers", () => {
    test("should handle multiple simultaneous event handlers", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();
      const onWorkflowStatusUpdate = vi.fn();
      const onTaskTitleUpdate = vi.fn();

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
          onWorkflowStatusUpdate,
          onTaskTitleUpdate,
        })
      );

      // All event handlers should be registered
      expect(mockChannel.bind).toHaveBeenCalledWith("new-message", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "workflow-status-update",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "task-title-update",
        expect.any(Function)
      );
    });
  });
});