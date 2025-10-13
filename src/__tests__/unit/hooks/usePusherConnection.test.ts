import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Channel } from "pusher-js";
import type { ChatMessage, WorkflowStatus } from "@/lib/chat";

// Mock pusher-js library - using factory to avoid hoisting issues
vi.mock("pusher-js", () => {
  const mockBind = vi.fn();
  const mockUnbindAll = vi.fn();
  const mockSubscribe = vi.fn();
  const mockUnsubscribe = vi.fn();
  const mockDisconnect = vi.fn();
  
  const mockChannel = {
    bind: mockBind,
    unbind: vi.fn(),
    unbind_all: mockUnbindAll,
    trigger: vi.fn(),
    name: "test-channel",
  };
  
  mockSubscribe.mockReturnValue(mockChannel);
  
  return {
    default: vi.fn().mockImplementation(() => ({
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      disconnect: mockDisconnect,
    })),
    __mockBind: mockBind,
    __mockUnbindAll: mockUnbindAll,
    __mockSubscribe: mockSubscribe,
    __mockUnsubscribe: mockUnsubscribe,
    __mockDisconnect: mockDisconnect,
    __mockChannel: mockChannel,
  };
});

// Mock the getPusherClient function
vi.mock("@/lib/pusher", async () => {
  const pusherModule = await import("pusher-js");
  const mockBind = (pusherModule as any).__mockBind;
  const mockUnbindAll = (pusherModule as any).__mockUnbindAll;
  const mockSubscribe = (pusherModule as any).__mockSubscribe;
  const mockUnsubscribe = (pusherModule as any).__mockUnsubscribe;
  const mockDisconnect = (pusherModule as any).__mockDisconnect;
  const mockChannel = (pusherModule as any).__mockChannel;
  
  mockSubscribe.mockReturnValue(mockChannel);
  
  const mockGetPusherClient = vi.fn(() => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    disconnect: mockDisconnect,
  }));
  
  const actual = await vi.importActual<typeof import("@/lib/pusher")>("@/lib/pusher");
  return {
    ...actual,
    getPusherClient: mockGetPusherClient,
    __mockGetPusherClient: mockGetPusherClient,
  };
});

// Import after mocking
import { usePusherConnection } from "@/hooks/usePusherConnection";

// Get mock references
const pusherModule = await import("pusher-js");
const pusherLib = await import("@/lib/pusher");

const mockBind = (pusherModule as any).__mockBind;
const mockUnbindAll = (pusherModule as any).__mockUnbindAll;
const mockSubscribe = (pusherModule as any).__mockSubscribe;
const mockUnsubscribe = (pusherModule as any).__mockUnsubscribe;
const mockDisconnect = (pusherModule as any).__mockDisconnect;
const mockChannel = (pusherModule as any).__mockChannel as Channel;
const mockGetPusherClient = (pusherLib as any).__mockGetPusherClient;

// Mock fetch for NEW_MESSAGE event testing
global.fetch = vi.fn();

describe("usePusherConnection Hook", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBind.mockClear();
    mockUnbindAll.mockClear();
    mockSubscribe.mockReturnValue(mockChannel);
    
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_PUSHER_KEY: "test-key",
      NEXT_PUBLIC_PUSHER_CLUSTER: "test-cluster",
    };

    // Reset fetch mock
    (global.fetch as any).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Connection Initialization", () => {
    it("should initialize with default state when no taskId or workspaceSlug provided", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
      expect(result.current.error).toBeNull();
      expect(mockGetPusherClient).not.toHaveBeenCalled();
    });

    it("should not connect when enabled is false", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task-123",
          enabled: false,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should connect when taskId is provided and enabled is true", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task-123",
          enabled: true,
        })
      );

      expect(mockGetPusherClient).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalledWith("task-test-task-123");
    });

    it("should connect when workspaceSlug is provided", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
          enabled: true,
        })
      );

      expect(mockGetPusherClient).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalledWith("workspace-test-workspace");
    });

    it("should prioritize taskId over workspaceSlug when both provided", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task-123",
          workspaceSlug: "test-workspace",
          enabled: true,
        })
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-test-task-123");
      expect(mockSubscribe).not.toHaveBeenCalledWith("workspace-test-workspace");
    });
  });

  describe("Channel Subscription - Task Channel", () => {
    it("should subscribe to correct task channel name", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "task-456",
        })
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-task-456");
    });

    it("should bind to pusher:subscription_succeeded event for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "pusher:subscription_succeeded",
        expect.any(Function)
      );
    });

    it("should bind to pusher:subscription_error event for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "pusher:subscription_error",
        expect.any(Function)
      );
    });

    it("should bind to NEW_MESSAGE event for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockBind).toHaveBeenCalledWith("new-message", expect.any(Function));
    });

    it("should bind to WORKFLOW_STATUS_UPDATE event for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "workflow-status-update",
        expect.any(Function)
      );
    });

    it("should bind to TASK_TITLE_UPDATE event for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "task-title-update",
        expect.any(Function)
      );
    });

    it("should not bind to workspace-specific events for task channel", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const bindCalls = mockBind.mock.calls.map((call) => call[0]);
      expect(bindCalls).not.toContain("recommendations-updated");
      expect(bindCalls).not.toContain("workspace-task-title-update");
    });
  });

  describe("Channel Subscription - Workspace Channel", () => {
    it("should subscribe to correct workspace channel name", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "my-workspace",
        })
      );

      expect(mockSubscribe).toHaveBeenCalledWith("workspace-my-workspace");
    });

    it("should bind to pusher:subscription_succeeded event for workspace channel", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "pusher:subscription_succeeded",
        expect.any(Function)
      );
    });

    it("should bind to pusher:subscription_error event for workspace channel", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "pusher:subscription_error",
        expect.any(Function)
      );
    });

    it("should bind to RECOMMENDATIONS_UPDATED event for workspace channel", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "recommendations-updated",
        expect.any(Function)
      );
    });

    it("should bind to WORKSPACE_TASK_TITLE_UPDATE event for workspace channel", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      expect(mockBind).toHaveBeenCalledWith(
        "workspace-task-title-update",
        expect.any(Function)
      );
    });

    it("should not bind to task-specific events for workspace channel", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      const bindCalls = mockBind.mock.calls.map((call) => call[0]);
      expect(bindCalls).not.toContain("new-message");
      expect(bindCalls).not.toContain("workflow-status-update");
      expect(bindCalls).not.toContain("task-title-update");
    });
  });

  describe("Connection State Management", () => {
    it("should set isConnected to true after subscription succeeded", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          connectionReadyDelay: 0,
        })
      );

      // Get the subscription_succeeded callback
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );
      expect(subscriptionSucceededCall).toBeDefined();

      // Trigger the callback
      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });

    it("should set connectionId after subscription succeeded", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task-123",
          connectionReadyDelay: 0,
        })
      );

      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.connectionId).toMatch(/^pusher_task_test-task-123_\d+$/);
      });
    });

    it("should respect connectionReadyDelay parameter", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          connectionReadyDelay: 50,
        })
      );

      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      // Should not be connected immediately
      expect(result.current.isConnected).toBe(false);

      // Should be connected after delay
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 200 }
      );
    });

    it("should use default connectionReadyDelay of 100ms", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      expect(result.current.isConnected).toBe(false);

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 200 }
      );
    });

    it("should clear error state on successful connection", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          connectionReadyDelay: 0,
        })
      );

      // First trigger an error
      const subscriptionErrorCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error"
      );
      
      act(() => {
        subscriptionErrorCall![1]({ error: "test error" });
      });

      expect(result.current.error).toBeTruthy();

      // Then trigger success
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe("Event Callback Invocation - Task Channel", () => {
    it("should call onMessage callback when NEW_MESSAGE event fires", async () => {
      const onMessage = vi.fn();
      const mockMessage: ChatMessage = {
        id: "msg-123",
        taskId: "test-task",
        role: "user",
        content: "Test message",
        createdAt: new Date(),
      } as any;

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockMessage }),
      });

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onMessage,
        })
      );

      // Get the NEW_MESSAGE callback
      const newMessageCall = mockBind.mock.calls.find(
        (call) => call[0] === "new-message"
      );
      expect(newMessageCall).toBeDefined();

      // Trigger the callback with message ID
      await act(async () => {
        await newMessageCall![1]("msg-123");
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/chat/messages/msg-123");
        expect(onMessage).toHaveBeenCalledWith(mockMessage);
      });
    });

    it("should handle NEW_MESSAGE fetch error gracefully", async () => {
      const onMessage = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onMessage,
        })
      );

      const newMessageCall = mockBind.mock.calls.find(
        (call) => call[0] === "new-message"
      );

      await act(async () => {
        await newMessageCall![1]("msg-123");
      });

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Failed to fetch message by id",
          "msg-123"
        );
        expect(onMessage).not.toHaveBeenCalled();
      });

      consoleError.mockRestore();
    });

    it("should handle NEW_MESSAGE network error gracefully", async () => {
      const onMessage = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onMessage,
        })
      );

      const newMessageCall = mockBind.mock.calls.find(
        (call) => call[0] === "new-message"
      );

      await act(async () => {
        await newMessageCall![1]("msg-123");
      });

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "Error handling NEW_MESSAGE event:",
          expect.any(Error)
        );
        expect(onMessage).not.toHaveBeenCalled();
      });

      consoleError.mockRestore();
    });

    it("should not call onMessage if callback not provided", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "msg-123" } }),
      });

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const newMessageCall = mockBind.mock.calls.find(
        (call) => call[0] === "new-message"
      );

      await act(async () => {
        await newMessageCall![1]("msg-123");
      });

      // Should not throw error
      expect(true).toBe(true);
    });

    it("should call onWorkflowStatusUpdate callback when WORKFLOW_STATUS_UPDATE event fires", () => {
      const onWorkflowStatusUpdate = vi.fn();
      const update = {
        taskId: "test-task",
        workflowStatus: "PROCESSING" as WorkflowStatus,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onWorkflowStatusUpdate,
        })
      );

      const workflowUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "workflow-status-update"
      );

      act(() => {
        workflowUpdateCall![1](update);
      });

      expect(onWorkflowStatusUpdate).toHaveBeenCalledWith(update);
    });

    it("should not call onWorkflowStatusUpdate if callback not provided", () => {
      const update = {
        taskId: "test-task",
        workflowStatus: "PROCESSING" as WorkflowStatus,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const workflowUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "workflow-status-update"
      );

      act(() => {
        workflowUpdateCall![1](update);
      });

      // Should not throw error
      expect(true).toBe(true);
    });

    it("should call onTaskTitleUpdate callback when TASK_TITLE_UPDATE event fires", () => {
      const onTaskTitleUpdate = vi.fn();
      const update = {
        taskId: "test-task",
        newTitle: "New Title",
        previousTitle: "Old Title",
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onTaskTitleUpdate,
        })
      );

      const titleUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "task-title-update"
      );

      act(() => {
        titleUpdateCall![1](update);
      });

      expect(onTaskTitleUpdate).toHaveBeenCalledWith(update);
    });

    it("should not call onTaskTitleUpdate if callback not provided", () => {
      const update = {
        taskId: "test-task",
        newTitle: "New Title",
        previousTitle: "Old Title",
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const titleUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "task-title-update"
      );

      act(() => {
        titleUpdateCall![1](update);
      });

      // Should not throw error
      expect(true).toBe(true);
    });
  });

  describe("Event Callback Invocation - Workspace Channel", () => {
    it("should call onRecommendationsUpdated callback when RECOMMENDATIONS_UPDATED event fires", () => {
      const onRecommendationsUpdated = vi.fn();
      const update = {
        workspaceSlug: "test-workspace",
        newRecommendationCount: 5,
        totalRecommendationCount: 20,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
          onRecommendationsUpdated,
        })
      );

      const recommendationsUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "recommendations-updated"
      );

      act(() => {
        recommendationsUpdateCall![1](update);
      });

      expect(onRecommendationsUpdated).toHaveBeenCalledWith(update);
    });

    it("should not call onRecommendationsUpdated if callback not provided", () => {
      const update = {
        workspaceSlug: "test-workspace",
        newRecommendationCount: 5,
        totalRecommendationCount: 20,
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      const recommendationsUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "recommendations-updated"
      );

      act(() => {
        recommendationsUpdateCall![1](update);
      });

      // Should not throw error
      expect(true).toBe(true);
    });

    it("should call onTaskTitleUpdate callback for workspace task title updates", () => {
      const onTaskTitleUpdate = vi.fn();
      const update = {
        taskId: "task-123",
        newTitle: "New Title",
        previousTitle: "Old Title",
        timestamp: new Date(),
      };

      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
          onTaskTitleUpdate,
        })
      );

      const titleUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "workspace-task-title-update"
      );

      act(() => {
        titleUpdateCall![1](update);
      });

      expect(onTaskTitleUpdate).toHaveBeenCalledWith(update);
    });
  });

  describe("Error Handling", () => {
    it("should set error state on subscription error for task channel", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const subscriptionErrorCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error"
      );

      act(() => {
        subscriptionErrorCall![1]({ error: "Connection failed" });
      });

      expect(result.current.error).toBe("Failed to connect to task real-time updates");
      expect(result.current.isConnected).toBe(false);
    });

    it("should set error state on subscription error for workspace channel", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
        })
      );

      const subscriptionErrorCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error"
      );

      act(() => {
        subscriptionErrorCall![1]({ error: "Connection failed" });
      });

      expect(result.current.error).toBe("Failed to connect to workspace real-time updates");
      expect(result.current.isConnected).toBe(false);
    });

    it("should handle getPusherClient errors gracefully", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockGetPusherClient.mockImplementationOnce(() => {
        throw new Error("Pusher initialization failed");
      });

      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(result.current.error).toBe("Failed to setup task real-time connection");
      expect(result.current.isConnected).toBe(false);
      expect(consoleError).toHaveBeenCalledWith(
        "Error setting up Pusher connection:",
        expect.any(Error)
      );

      consoleError.mockRestore();
    });

    it("should log subscription errors to console", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      const subscriptionErrorCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error"
      );

      act(() => {
        subscriptionErrorCall![1]({ error: "Connection failed" });
      });

      expect(consoleError).toHaveBeenCalledWith(
        "Pusher subscription error:",
        { error: "Connection failed" }
      );

      consoleError.mockRestore();
    });
  });

  describe("Cleanup Behavior", () => {
    it("should call unbind_all when disconnecting", () => {
      const { unmount } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      unmount();

      expect(mockUnbindAll).toHaveBeenCalled();
    });

    it("should call unsubscribe with correct channel name on unmount", () => {
      const { unmount } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task-123",
        })
      );

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledWith("task-test-task-123");
    });

    it("should reset connection state on disconnect", () => {
      const { result, unmount } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          connectionReadyDelay: 0,
        })
      );

      // Connect first
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      // Wait for connection
      expect(result.current.isConnected).toBe(false);

      // Disconnect
      unmount();

      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
    });

    it("should disconnect from previous channel when switching channels", () => {
      const { rerender } = renderHook(
        ({ taskId }) => usePusherConnection({ taskId }),
        { initialProps: { taskId: "task-1" } }
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-task-1");

      // Switch to different task
      rerender({ taskId: "task-2" });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-task-1");
      expect(mockSubscribe).toHaveBeenCalledWith("task-task-2");
    });

    it("should disconnect when switching from task to workspace channel", () => {
      const { rerender } = renderHook(
        ({ taskId, workspaceSlug }) => usePusherConnection({ taskId, workspaceSlug }),
        { initialProps: { taskId: "task-1" as string | undefined, workspaceSlug: undefined } }
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-task-1");

      // Switch to workspace
      rerender({ taskId: undefined, workspaceSlug: "workspace-1" });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-task-1");
      expect(mockSubscribe).toHaveBeenCalledWith("workspace-workspace-1");
    });

    it("should not attempt to disconnect if no active connection", () => {
      const { unmount } = renderHook(() =>
        usePusherConnection({
          enabled: false,
        })
      );

      unmount();

      expect(mockUnbindAll).not.toHaveBeenCalled();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("Enabled/Disabled State", () => {
    it("should disconnect when enabled changes from true to false", () => {
      const { rerender } = renderHook(
        ({ enabled }) => usePusherConnection({ taskId: "test-task", enabled }),
        { initialProps: { enabled: true } }
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-test-task");

      // Disable connection
      rerender({ enabled: false });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-test-task");
    });

    it("should reconnect when enabled changes from false to true", () => {
      const { rerender } = renderHook(
        ({ enabled }) => usePusherConnection({ taskId: "test-task", enabled }),
        { initialProps: { enabled: false } }
      );

      expect(mockSubscribe).not.toHaveBeenCalled();

      // Enable connection
      rerender({ enabled: true });

      expect(mockSubscribe).toHaveBeenCalledWith("task-test-task");
    });

    it("should not connect if enabled is false even with taskId", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          enabled: false,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should default enabled to true", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(mockGetPusherClient).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  describe("Connect and Disconnect Methods", () => {
    it("should expose connect method", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      expect(typeof result.current.connect).toBe("function");
    });

    it("should expose disconnect method", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      expect(typeof result.current.disconnect).toBe("function");
    });

    it("should connect to task channel when calling connect method", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      act(() => {
        result.current.connect("task-123", "task");
      });

      expect(mockSubscribe).toHaveBeenCalledWith("task-task-123");
    });

    it("should connect to workspace channel when calling connect method", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      act(() => {
        result.current.connect("workspace-456", "workspace");
      });

      expect(mockSubscribe).toHaveBeenCalledWith("workspace-workspace-456");
    });

    it("should disconnect from existing channel before connecting to new one", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "task-1",
        })
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-task-1");

      act(() => {
        result.current.connect("task-2", "task");
      });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-task-1");
      expect(mockSubscribe).toHaveBeenCalledWith("task-task-2");
    });

    it("should cleanup connection when calling disconnect method", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      act(() => {
        result.current.disconnect();
      });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-test-task");
    });

    it("should handle disconnect gracefully when no active connection", () => {
      const { result } = renderHook(() => usePusherConnection({}));

      act(() => {
        result.current.disconnect();
      });

      expect(mockUnbindAll).not.toHaveBeenCalled();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("Callback Reference Stability", () => {
    it("should use latest onMessage callback without reconnecting", async () => {
      const onMessage1 = vi.fn();
      const onMessage2 = vi.fn();
      const mockMessage = { id: "msg-1" } as any;

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockMessage }),
      });

      const { rerender } = renderHook(
        ({ onMessage }) => usePusherConnection({ taskId: "test-task", onMessage }),
        { initialProps: { onMessage: onMessage1 } }
      );

      const initialSubscribeCalls = mockSubscribe.mock.calls.length;

      // Update callback
      rerender({ onMessage: onMessage2 });

      // Should not reconnect
      expect(mockSubscribe).toHaveBeenCalledTimes(initialSubscribeCalls);

      // Get the NEW_MESSAGE callback and trigger it
      const newMessageCall = mockBind.mock.calls.find(
        (call) => call[0] === "new-message"
      );

      await act(async () => {
        await newMessageCall![1]("msg-1");
      });

      await waitFor(() => {
        expect(onMessage1).not.toHaveBeenCalled();
        expect(onMessage2).toHaveBeenCalledWith(mockMessage);
      });
    });

    it("should use latest onWorkflowStatusUpdate callback without reconnecting", () => {
      const onWorkflowStatusUpdate1 = vi.fn();
      const onWorkflowStatusUpdate2 = vi.fn();
      const update = { taskId: "test-task", workflowStatus: "PROCESSING" as WorkflowStatus };

      const { rerender } = renderHook(
        ({ onWorkflowStatusUpdate }) =>
          usePusherConnection({ taskId: "test-task", onWorkflowStatusUpdate }),
        { initialProps: { onWorkflowStatusUpdate: onWorkflowStatusUpdate1 } }
      );

      const initialSubscribeCalls = mockSubscribe.mock.calls.length;

      rerender({ onWorkflowStatusUpdate: onWorkflowStatusUpdate2 });

      expect(mockSubscribe).toHaveBeenCalledTimes(initialSubscribeCalls);

      const workflowUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "workflow-status-update"
      );

      act(() => {
        workflowUpdateCall![1](update);
      });

      expect(onWorkflowStatusUpdate1).not.toHaveBeenCalled();
      expect(onWorkflowStatusUpdate2).toHaveBeenCalledWith(update);
    });

    it("should use latest onRecommendationsUpdated callback without reconnecting", () => {
      const onRecommendationsUpdated1 = vi.fn();
      const onRecommendationsUpdated2 = vi.fn();
      const update = { workspaceSlug: "test", newRecommendationCount: 5, totalRecommendationCount: 10 };

      const { rerender } = renderHook(
        ({ onRecommendationsUpdated }) =>
          usePusherConnection({ workspaceSlug: "test-workspace", onRecommendationsUpdated }),
        { initialProps: { onRecommendationsUpdated: onRecommendationsUpdated1 } }
      );

      const initialSubscribeCalls = mockSubscribe.mock.calls.length;

      rerender({ onRecommendationsUpdated: onRecommendationsUpdated2 });

      expect(mockSubscribe).toHaveBeenCalledTimes(initialSubscribeCalls);

      const recommendationsUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "recommendations-updated"
      );

      act(() => {
        recommendationsUpdateCall![1](update);
      });

      expect(onRecommendationsUpdated1).not.toHaveBeenCalled();
      expect(onRecommendationsUpdated2).toHaveBeenCalledWith(update);
    });

    it("should use latest onTaskTitleUpdate callback without reconnecting", () => {
      const onTaskTitleUpdate1 = vi.fn();
      const onTaskTitleUpdate2 = vi.fn();
      const update = { taskId: "test", newTitle: "New", previousTitle: "Old" };

      const { rerender } = renderHook(
        ({ onTaskTitleUpdate }) =>
          usePusherConnection({ taskId: "test-task", onTaskTitleUpdate }),
        { initialProps: { onTaskTitleUpdate: onTaskTitleUpdate1 } }
      );

      const initialSubscribeCalls = mockSubscribe.mock.calls.length;

      rerender({ onTaskTitleUpdate: onTaskTitleUpdate2 });

      expect(mockSubscribe).toHaveBeenCalledTimes(initialSubscribeCalls);

      const titleUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "task-title-update"
      );

      act(() => {
        titleUpdateCall![1](update);
      });

      expect(onTaskTitleUpdate1).not.toHaveBeenCalled();
      expect(onTaskTitleUpdate2).toHaveBeenCalledWith(update);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null taskId gracefully", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: null,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should handle null workspaceSlug gracefully", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: null,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should handle undefined taskId gracefully", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: undefined,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should handle undefined workspaceSlug gracefully", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: undefined,
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should disconnect when taskId changes to null", () => {
      const { rerender } = renderHook(
        ({ taskId }) => usePusherConnection({ taskId }),
        { initialProps: { taskId: "test-task" as string | null } }
      );

      expect(mockSubscribe).toHaveBeenCalledWith("task-test-task");

      rerender({ taskId: null });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-test-task");
    });

    it("should disconnect when workspaceSlug changes to null", () => {
      const { rerender } = renderHook(
        ({ workspaceSlug }) => usePusherConnection({ workspaceSlug }),
        { initialProps: { workspaceSlug: "test-workspace" as string | null } }
      );

      expect(mockSubscribe).toHaveBeenCalledWith("workspace-test-workspace");

      rerender({ workspaceSlug: null });

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("workspace-test-workspace");
    });

    it("should handle rapid channel switching", () => {
      const { rerender } = renderHook(
        ({ taskId }) => usePusherConnection({ taskId }),
        { initialProps: { taskId: "task-1" } }
      );

      rerender({ taskId: "task-2" });
      rerender({ taskId: "task-3" });
      rerender({ taskId: "task-4" });

      expect(mockUnbindAll).toHaveBeenCalledTimes(3);
      expect(mockUnsubscribe).toHaveBeenCalledTimes(3);
      expect(mockSubscribe).toHaveBeenCalledWith("task-task-4");
    });

    it("should handle same taskId on rerender without reconnecting", () => {
      const { rerender } = renderHook(
        ({ taskId }) => usePusherConnection({ taskId }),
        { initialProps: { taskId: "test-task" } }
      );

      const initialCalls = mockSubscribe.mock.calls.length;

      rerender({ taskId: "test-task" });

      expect(mockSubscribe).toHaveBeenCalledTimes(initialCalls);
      expect(mockUnbindAll).not.toHaveBeenCalled();
    });

    it("should handle same workspaceSlug on rerender without reconnecting", () => {
      const { rerender } = renderHook(
        ({ workspaceSlug }) => usePusherConnection({ workspaceSlug }),
        { initialProps: { workspaceSlug: "test-workspace" } }
      );

      const initialCalls = mockSubscribe.mock.calls.length;

      rerender({ workspaceSlug: "test-workspace" });

      expect(mockSubscribe).toHaveBeenCalledTimes(initialCalls);
      expect(mockUnbindAll).not.toHaveBeenCalled();
    });

    it("should handle empty string taskId as falsy", () => {
      renderHook(() =>
        usePusherConnection({
          taskId: "",
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should handle empty string workspaceSlug as falsy", () => {
      renderHook(() =>
        usePusherConnection({
          workspaceSlug: "",
        })
      );

      expect(mockGetPusherClient).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it("should handle unmount during connection setup", () => {
      const { unmount } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      // Unmount immediately without waiting for connection
      unmount();

      // Should cleanup gracefully
      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("Return Value Structure", () => {
    it("should return all expected properties", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(result.current).toHaveProperty("isConnected");
      expect(result.current).toHaveProperty("connectionId");
      expect(result.current).toHaveProperty("connect");
      expect(result.current).toHaveProperty("disconnect");
      expect(result.current).toHaveProperty("error");
    });

    it("should have correct types for return values", () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
        })
      );

      expect(typeof result.current.isConnected).toBe("boolean");
      expect(result.current.connectionId === null || typeof result.current.connectionId === "string").toBe(true);
      expect(typeof result.current.connect).toBe("function");
      expect(typeof result.current.disconnect).toBe("function");
      expect(result.current.error === null || typeof result.current.error === "string").toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete connection lifecycle for task channel", async () => {
      const onMessage = vi.fn();
      const onWorkflowStatusUpdate = vi.fn();

      const { result, unmount } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          onMessage,
          onWorkflowStatusUpdate,
          connectionReadyDelay: 0,
        })
      );

      // Verify initial state
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionId).toBeNull();
      expect(result.current.error).toBeNull();

      // Trigger successful connection
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      expect(result.current.connectionId).toBeTruthy();
      expect(result.current.error).toBeNull();

      // Trigger events
      const workflowUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "workflow-status-update"
      );

      act(() => {
        workflowUpdateCall![1]({
          taskId: "test-task",
          workflowStatus: "PROCESSING",
        });
      });

      expect(onWorkflowStatusUpdate).toHaveBeenCalled();

      // Cleanup
      unmount();

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("task-test-task");
    });

    it("should handle complete connection lifecycle for workspace channel", async () => {
      const onRecommendationsUpdated = vi.fn();

      const { result, unmount } = renderHook(() =>
        usePusherConnection({
          workspaceSlug: "test-workspace",
          onRecommendationsUpdated,
          connectionReadyDelay: 0,
        })
      );

      // Verify initial state
      expect(result.current.isConnected).toBe(false);

      // Trigger successful connection
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Trigger event
      const recommendationsUpdateCall = mockBind.mock.calls.find(
        (call) => call[0] === "recommendations-updated"
      );

      act(() => {
        recommendationsUpdateCall![1]({
          workspaceSlug: "test-workspace",
          newRecommendationCount: 5,
          totalRecommendationCount: 10,
        });
      });

      expect(onRecommendationsUpdated).toHaveBeenCalled();

      // Cleanup
      unmount();

      expect(mockUnbindAll).toHaveBeenCalled();
      expect(mockUnsubscribe).toHaveBeenCalledWith("workspace-test-workspace");
    });

    it("should handle error recovery", async () => {
      const { result } = renderHook(() =>
        usePusherConnection({
          taskId: "test-task",
          connectionReadyDelay: 0,
        })
      );

      // Trigger error
      const subscriptionErrorCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_error"
      );

      act(() => {
        subscriptionErrorCall![1]({ error: "Connection failed" });
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.isConnected).toBe(false);

      // Recover with successful connection
      const subscriptionSucceededCall = mockBind.mock.calls.find(
        (call) => call[0] === "pusher:subscription_succeeded"
      );

      act(() => {
        subscriptionSucceededCall![1]();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.error).toBeNull();
      });
    });
  });
});