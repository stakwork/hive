import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePusherConnection } from "@/hooks/usePusherConnection";
import type { Channel } from "pusher-js";

// Mock modules (must be hoisted before any other code)
vi.mock("pusher-js", () => ({
  default: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(),
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((workspaceSlug: string) => `workspace-${workspaceSlug}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    CONNECTION_COUNT: "connection-count",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Import mocked modules after vi.mock
import { getPusherClient, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Get reference to mocked PUSHER_EVENTS for test use
const MOCK_PUSHER_EVENTS = PUSHER_EVENTS;

// Mock the Pusher library and helper functions
const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
  unbind_all: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
};

// Mock fetch globally for NEW_MESSAGE event handler
global.fetch = vi.fn();

describe("usePusherConnection Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up getPusherClient to return our mockPusherClient
    vi.mocked(getPusherClient).mockReturnValue(mockPusherClient as any);

    // Reset mock implementations
    mockChannel.bind.mockImplementation(() => {});
    mockChannel.unbind.mockImplementation(() => {});
    mockChannel.unbind_all.mockImplementation(() => {});
    mockPusherClient.subscribe.mockReturnValue(mockChannel as unknown as Channel);
    mockPusherClient.unsubscribe.mockImplementation(() => {});

    // Reset fetch mock
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "msg-1", content: "Test message" } }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Initial State", () => {
    test("should return initial state when not connected", () => {
      const { result } = renderHook(() => usePusherConnection({ enabled: false }));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
      expect(result.current.error).toBeNull();
      expect(typeof result.current.connect).toBe("function");
      expect(typeof result.current.disconnect).toBe("function");
    });

    test("should not attempt connection when enabled is false", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "task-123",
          enabled: false,
        }),
      );

      expect(getPusherClient).not.toHaveBeenCalled();
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should not connect when no taskId or workspaceSlug provided", () => {
      renderHook(() => usePusherConnection({ enabled: true }));

      expect(getPusherClient).not.toHaveBeenCalled();
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("Task Channel Connection", () => {
    test("should connect to task channel when taskId is provided", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        }),
      );

      expect(getTaskChannelName).toHaveBeenCalledWith(taskId);
      expect(getPusherClient).toHaveBeenCalled();
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should bind to task-specific events", () => {
      const taskId = "task-123";

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        }),
      );

      // Verify Pusher internal events are bound
      expect(mockChannel.bind).toHaveBeenCalledWith("pusher:subscription_succeeded", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith("pusher:subscription_error", expect.any(Function));

      // Verify task-specific events are bound
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.NEW_MESSAGE, expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.TASK_TITLE_UPDATE, expect.any(Function));
    });

    test("should update connection state on successful subscription", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          connectionReadyDelay: 0, // No delay for testing
        }),
      );

      // Simulate successful subscription
      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];

      expect(subscriptionSuccessCallback).toBeDefined();
      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connectionId).toMatch(/^pusher_task_task-123_/);
        expect(result.current.error).toBeNull();
      });
    });

    test("should handle subscription error", async () => {
      const taskId = "task-123";
      const error = { message: "Connection failed" };

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        }),
      );

      // Simulate subscription error
      const subscriptionErrorCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error",
      )?.[1];

      expect(subscriptionErrorCallback).toBeDefined();
      subscriptionErrorCallback?.(error);

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.error).toBe("Failed to connect to task real-time updates");
      });
    });

    test("should switch to new task channel when taskId changes", () => {
      const { rerender } = renderHook(({ taskId }) => usePusherConnection({ taskId, enabled: true }), {
        initialProps: { taskId: "task-123" },
      });

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-123");

      // Change taskId
      rerender({ taskId: "task-456" });

      // Should unsubscribe from old channel
      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-123");

      // Should subscribe to new channel
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-456");
    });
  });

  describe("Workspace Channel Connection", () => {
    test("should connect to workspace channel when workspaceSlug is provided", () => {
      const workspaceSlug = "test-workspace";

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
        }),
      );

      expect(getWorkspaceChannelName).toHaveBeenCalledWith(workspaceSlug);
      expect(getPusherClient).toHaveBeenCalled();
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`workspace-${workspaceSlug}`);
    });

    test("should bind to workspace-specific events", () => {
      const workspaceSlug = "test-workspace";

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
        }),
      );

      // Verify workspace-specific events are bound
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.RECOMMENDATIONS_UPDATED, expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(
        MOCK_PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.any(Function),
      );
    });

    test("should update connection state with workspace connection ID", async () => {
      const workspaceSlug = "test-workspace";

      const { result } = renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          connectionReadyDelay: 0,
        }),
      );

      // Simulate successful subscription
      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];

      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connectionId).toMatch(/^pusher_workspace_test-workspace_/);
      });
    });

    test("should prioritize taskId over workspaceSlug when both provided", () => {
      const taskId = "task-123";
      const workspaceSlug = "test-workspace";

      renderHook(() =>
        usePusherConnection({
          taskId,
          workspaceSlug,
          enabled: true,
        }),
      );

      // Should connect to task channel, not workspace
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`task-${taskId}`);
      expect(mockPusherClient.subscribe).not.toHaveBeenCalledWith(`workspace-${workspaceSlug}`);
    });
  });

  describe("Event Handler Callbacks", () => {
    test("should call onMessage callback when NEW_MESSAGE event is received", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();
      const mockMessage = { id: "msg-1", content: "Test message", role: "user", createdAt: new Date().toISOString() };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockMessage }),
      });

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        }),
      );

      // Get the NEW_MESSAGE callback
      const newMessageCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.NEW_MESSAGE,
      )?.[1];

      expect(newMessageCallback).toBeDefined();

      // Simulate receiving message ID
      await newMessageCallback?.("msg-1");

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/chat/messages/msg-1");
        expect(onMessage).toHaveBeenCalledWith(mockMessage);
      });
    });

    test("should call onWorkflowStatusUpdate callback when WORKFLOW_STATUS_UPDATE event is received", () => {
      const taskId = "task-123";
      const onWorkflowStatusUpdate = vi.fn();
      const mockUpdate = {
        taskId,
        workflowStatus: "IN_PROGRESS" as const,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onWorkflowStatusUpdate,
        }),
      );

      // Get the WORKFLOW_STATUS_UPDATE callback
      const workflowStatusCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      )?.[1];

      expect(workflowStatusCallback).toBeDefined();

      // Simulate workflow status update
      workflowStatusCallback?.(mockUpdate);

      expect(onWorkflowStatusUpdate).toHaveBeenCalledWith(mockUpdate);
    });

    test("should call onTaskTitleUpdate callback when TASK_TITLE_UPDATE event is received", () => {
      const taskId = "task-123";
      const onTaskTitleUpdate = vi.fn();
      const mockUpdate = {
        taskId,
        newTitle: "Updated Title",
        previousTitle: "Old Title",
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onTaskTitleUpdate,
        }),
      );

      // Get the TASK_TITLE_UPDATE callback
      const taskTitleCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.TASK_TITLE_UPDATE,
      )?.[1];

      expect(taskTitleCallback).toBeDefined();

      // Simulate task title update
      taskTitleCallback?.(mockUpdate);

      expect(onTaskTitleUpdate).toHaveBeenCalledWith(mockUpdate);
    });

    test("should call onRecommendationsUpdated callback when RECOMMENDATIONS_UPDATED event is received", () => {
      const workspaceSlug = "test-workspace";
      const onRecommendationsUpdated = vi.fn();
      const mockUpdate = {
        workspaceSlug,
        newRecommendationCount: 5,
        totalRecommendationCount: 10,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onRecommendationsUpdated,
        }),
      );

      // Get the RECOMMENDATIONS_UPDATED callback
      const recommendationsCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
      )?.[1];

      expect(recommendationsCallback).toBeDefined();

      // Simulate recommendations update
      recommendationsCallback?.(mockUpdate);

      expect(onRecommendationsUpdated).toHaveBeenCalledWith(mockUpdate);
    });

    test("should handle NEW_MESSAGE event with fetch error gracefully", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        }),
      );

      // Get the NEW_MESSAGE callback
      const newMessageCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.NEW_MESSAGE,
      )?.[1];

      // Simulate receiving message ID with failed fetch
      await newMessageCallback?.("msg-1");

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/chat/messages/msg-1");
        expect(onMessage).not.toHaveBeenCalled();
      });
    });

    test("should handle NEW_MESSAGE event with non-string payload gracefully", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
        }),
      );

      // Get the NEW_MESSAGE callback
      const newMessageCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.NEW_MESSAGE,
      )?.[1];

      // Simulate receiving non-string payload
      await newMessageCallback?.({ invalid: "payload" });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(onMessage).not.toHaveBeenCalled();
    });

    test("should update callback refs without re-subscribing", () => {
      const taskId = "task-123";
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();

      const { rerender } = renderHook(({ onMessage }) => usePusherConnection({ taskId, enabled: true, onMessage }), {
        initialProps: { onMessage: onMessage1 },
      });

      const initialSubscribeCount = mockPusherClient.subscribe.mock.calls.length;

      // Change callback
      rerender({ onMessage: onMessage2 });

      // Should not re-subscribe
      expect(mockPusherClient.subscribe).toHaveBeenCalledTimes(initialSubscribeCount);
      expect(mockPusherClient.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("Disconnect Functionality", () => {
    test("should disconnect from channel using disconnect method", async () => {
      const taskId = "task-123";

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          connectionReadyDelay: 0,
        }),
      );

      // Connect first
      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];
      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Now disconnect
      result.current.disconnect();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.connectionId).toBeNull();
        expect(result.current.error).toBeNull();
      });
    });

    test("should disconnect when enabled is set to false", () => {
      const taskId = "task-123";

      const { rerender } = renderHook(({ enabled }) => usePusherConnection({ taskId, enabled }), {
        initialProps: { enabled: true },
      });

      expect(mockPusherClient.subscribe).toHaveBeenCalled();

      // Disable connection
      rerender({ enabled: false });

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should disconnect when both taskId and workspaceSlug are removed", () => {
      const { rerender } = renderHook(({ taskId }) => usePusherConnection({ taskId, enabled: true }), {
        initialProps: { taskId: "task-123" as string | null },
      });

      expect(mockPusherClient.subscribe).toHaveBeenCalled();

      // Remove taskId
      rerender({ taskId: null });

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalled();
    });

    test("should handle disconnect when not connected", () => {
      const { result } = renderHook(() => usePusherConnection({ enabled: false }));

      // Should not throw when disconnecting without being connected
      expect(() => result.current.disconnect()).not.toThrow();
      expect(mockChannel.unbind_all).not.toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("Cleanup on Unmount", () => {
    test("should cleanup connection on unmount", () => {
      const taskId = "task-123";

      const { unmount } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        }),
      );

      expect(mockPusherClient.subscribe).toHaveBeenCalled();

      // Unmount component
      unmount();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should cleanup workspace connection on unmount", () => {
      const workspaceSlug = "test-workspace";

      const { unmount } = renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
        }),
      );

      expect(mockPusherClient.subscribe).toHaveBeenCalled();

      // Unmount component
      unmount();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`workspace-${workspaceSlug}`);
    });

    test("should not error on unmount when not connected", () => {
      const { unmount } = renderHook(() => usePusherConnection({ enabled: false }));

      // Should not throw
      expect(() => unmount()).not.toThrow();
      expect(mockChannel.unbind_all).not.toHaveBeenCalled();
    });
  });

  describe("Connection Management", () => {
    test("should use connect method to establish task connection", async () => {
      const { result } = renderHook(() => usePusherConnection({ enabled: false }));

      expect(result.current.isConnected).toBe(false);

      // Manually connect to task
      result.current.connect("task-123", "task");

      expect(getTaskChannelName).toHaveBeenCalledWith("task-123");
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-123");
    });

    test("should use connect method to establish workspace connection", async () => {
      const { result } = renderHook(() => usePusherConnection({ enabled: false }));

      expect(result.current.isConnected).toBe(false);

      // Manually connect to workspace
      result.current.connect("test-workspace", "workspace");

      expect(getWorkspaceChannelName).toHaveBeenCalledWith("test-workspace");
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-test-workspace");
    });

    test("should disconnect from previous channel when manually connecting to new channel", () => {
      const { result } = renderHook(() => usePusherConnection({ enabled: false }));

      // Connect to first channel
      result.current.connect("task-123", "task");
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-123");

      vi.clearAllMocks();

      // Connect to second channel
      result.current.connect("task-456", "task");

      // Should disconnect from first
      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-123");

      // Should connect to second
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-456");
    });
  });

  describe("Configuration Options", () => {
    test("should respect connectionReadyDelay parameter", async () => {
      vi.useFakeTimers();
      try {
        const taskId = "task-123";
        const delay = 200;

        const { result } = renderHook(() =>
          usePusherConnection({
            taskId,
            enabled: true,
            connectionReadyDelay: delay,
          }),
        );

        // Simulate successful subscription
        const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
          (call) => call[0] === "pusher:subscription_succeeded",
        )?.[1];

        act(() => {
          subscriptionSuccessCallback?.();
        });

        // Should not be connected immediately
        expect(result.current.isConnected).toBe(false);

        // Advance timers by the delay amount
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });

        // Should be connected after delay
        expect(result.current.isConnected).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    test("should work without optional callback parameters", () => {
      const taskId = "task-123";

      // Should not throw without callbacks
      expect(() => {
        renderHook(() => usePusherConnection({ taskId, enabled: true }));
      }).not.toThrow();

      expect(mockPusherClient.subscribe).toHaveBeenCalled();
    });

    test("should handle all optional callbacks provided", () => {
      const taskId = "task-123";
      const callbacks = {
        onMessage: vi.fn(),
        onWorkflowStatusUpdate: vi.fn(),
        onTaskTitleUpdate: vi.fn(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          ...callbacks,
        }),
      );

      // All event handlers should be bound
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.NEW_MESSAGE, expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith(MOCK_PUSHER_EVENTS.TASK_TITLE_UPDATE, expect.any(Function));
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    test("should handle empty string taskId", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "",
          enabled: true,
        }),
      );

      // Empty strings are treated as falsy, should not attempt connection
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should handle empty string workspaceSlug", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "",
          enabled: true,
        }),
      );

      // Empty strings are treated as falsy, should not attempt connection
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should handle null taskId", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: null,
          enabled: true,
        }),
      );

      // Should not attempt connection
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should handle null workspaceSlug", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: null,
          enabled: true,
        }),
      );

      // Should not attempt connection
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should handle undefined taskId", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: undefined,
          enabled: true,
        }),
      );

      // Should not attempt connection
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    });

    test("should handle connection errors during setup", () => {
      const taskId = "task-123";
      mockPusherClient.subscribe.mockImplementationOnce(() => {
        throw new Error("Connection failed");
      });

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
        }),
      );

      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBe("Failed to setup task real-time connection");
    });

    test("should handle rapid enable/disable toggling", () => {
      const taskId = "task-123";

      const { rerender } = renderHook(({ enabled }) => usePusherConnection({ taskId, enabled }), {
        initialProps: { enabled: true },
      });

      // Toggle multiple times
      rerender({ enabled: false });
      rerender({ enabled: true });
      rerender({ enabled: false });
      rerender({ enabled: true });

      // Should handle gracefully without errors
      expect(mockPusherClient.subscribe).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalled();
    });

    test("should maintain stable disconnect function reference", () => {
      const { result, rerender } = renderHook(() => usePusherConnection({ taskId: "task-123", enabled: true }));

      const disconnectRef1 = result.current.disconnect;

      rerender();

      const disconnectRef2 = result.current.disconnect;

      // Disconnect function should be stable across renders
      expect(disconnectRef1).toBe(disconnectRef2);
    });

    test("should maintain stable connect function reference", () => {
      const { result, rerender } = renderHook(() => usePusherConnection({ taskId: "task-123", enabled: true }));

      const connectRef1 = result.current.connect;

      rerender();

      const connectRef2 = result.current.connect;

      // Connect function should be stable across renders
      expect(connectRef1).toBe(connectRef2);
    });
  });

  describe("Integration Scenarios", () => {
    test("should handle complete connection lifecycle for task channel", async () => {
      const taskId = "task-123";
      const onMessage = vi.fn();

      const { result, unmount } = renderHook(() =>
        usePusherConnection({
          taskId,
          enabled: true,
          onMessage,
          connectionReadyDelay: 0,
        }),
      );

      // 1. Initial state
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();

      // 2. Simulate successful connection
      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];
      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.connectionId).toBeTruthy();
      });

      // 3. Receive message
      const newMessageCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.NEW_MESSAGE,
      )?.[1];

      await newMessageCallback?.("msg-123");

      await waitFor(() => {
        expect(onMessage).toHaveBeenCalled();
      });

      // 4. Cleanup on unmount
      unmount();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`task-${taskId}`);
    });

    test("should handle complete connection lifecycle for workspace channel", async () => {
      const workspaceSlug = "test-workspace";
      const onRecommendationsUpdated = vi.fn();

      const { result, unmount } = renderHook(() =>
        usePusherConnection({
          workspaceSlug,
          enabled: true,
          onRecommendationsUpdated,
          connectionReadyDelay: 0,
        }),
      );

      // 1. Initial state
      expect(result.current.isConnected).toBe(false);

      // 2. Simulate successful connection
      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];
      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // 3. Receive recommendations update
      const recommendationsCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === MOCK_PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
      )?.[1];

      const mockUpdate = {
        workspaceSlug,
        newRecommendationCount: 5,
        totalRecommendationCount: 10,
        timestamp: new Date(),
      };
      recommendationsCallback?.(mockUpdate);

      expect(onRecommendationsUpdated).toHaveBeenCalledWith(mockUpdate);

      // 4. Cleanup on unmount
      unmount();

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(`workspace-${workspaceSlug}`);
    });

    test("should handle channel switching from task to workspace", async () => {
      const { result, rerender } = renderHook(
        ({ taskId, workspaceSlug }) =>
          usePusherConnection({
            taskId,
            workspaceSlug,
            enabled: true,
            connectionReadyDelay: 0,
          }),
        {
          initialProps: {
            taskId: "task-123" as string | null,
            workspaceSlug: null as string | null,
          },
        },
      );

      // Connected to task
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("task-task-123");

      const subscriptionSuccessCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded",
      )?.[1];
      subscriptionSuccessCallback?.();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Switch to workspace
      rerender({ taskId: null, workspaceSlug: "test-workspace" });

      // Should disconnect from task and connect to workspace
      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("task-task-123");
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-test-workspace");
    });
  });
});
