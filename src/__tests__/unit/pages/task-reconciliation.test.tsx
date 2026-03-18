import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

// Make React globally available for components using new JSX transform
if (typeof (global as any).React === "undefined") {
  (global as any).React = React;
}

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that trigger the component tree
// ---------------------------------------------------------------------------

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
    },
    status: "authenticated",
  })),
}));

const mockPush = vi.fn();
const mockGet = vi.fn(() => null);
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ slug: "test-ws", taskParams: ["task-abc"] })),
  useSearchParams: vi.fn(() => ({ get: mockGet })),
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn() })),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "ws-1",
    workspace: { id: "ws-1", slug: "test-ws" },
    workspaceId: "ws-1",
  }),
}));

vi.mock("@/hooks/useTaskMode", () => ({
  useTaskMode: () => ({ taskMode: "chat", setTaskMode: vi.fn() }),
}));

vi.mock("@/hooks/usePoolStatus", () => ({
  usePoolStatus: () => ({ poolStatus: null, loading: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useWorkflowNodes", () => ({
  useWorkflowNodes: () => ({ workflows: [], isLoading: false, error: null }),
}));

// usePusherConnection — captures the onWorkflowStatusUpdate callback so tests can call it
let capturedOnWorkflowStatusUpdate: ((update: any) => void) | null = null;
vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn((opts: any) => {
    capturedOnWorkflowStatusUpdate = opts?.onWorkflowStatusUpdate ?? null;
    return { isConnected: true, error: null };
  }),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => null),
}));

vi.mock("@/hooks/useChatForm", () => ({
  useChatForm: () => ({ hasActiveChatForm: false, webhook: null }),
}));

vi.mock("@/hooks/useProjectLogWebSocket", () => ({
  useProjectLogWebSocket: () => ({ logs: [], lastLogLine: null, clearLogs: vi.fn() }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({ processChunk: vi.fn(), reset: vi.fn() }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components", () => {
  const React = require("react");
  return {
    TaskStartInput: () => React.createElement("div", { "data-testid": "task-start-input" }),
    ChatArea: () => React.createElement("div", { "data-testid": "chat-area" }),
    AgentChatArea: () => React.createElement("div", { "data-testid": "agent-chat-area" }),
    ArtifactsPanel: () => React.createElement("div", { "data-testid": "artifacts-panel" }),
    CommitModal: () => null,
    BountyRequestModal: () => null,
  };
});

vi.mock("@/components/ui/resizable", () => {
  const React = require("react");
  return {
    ResizablePanel: ({ children }: any) => React.createElement("div", null, children),
    ResizablePanelGroup: ({ children }: any) => React.createElement("div", null, children),
    ResizableHandle: () => React.createElement("div", null),
  };
});

vi.mock("framer-motion", () => {
  const React = require("react");
  return {
    motion: {
      div: ({ children, ...props }: any) => React.createElement("div", props, children),
    },
    AnimatePresence: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// ---------------------------------------------------------------------------
// useWorkflowPolling mock — controllable per-test
// ---------------------------------------------------------------------------
let mockWorkflowPollingData: any = null;
vi.mock("@/hooks/useWorkflowPolling", () => ({
  TERMINAL_STATUSES: ["completed", "failed", "error", "halted", "paused", "stopped"],
  useWorkflowPolling: vi.fn(() => ({
    workflowData: mockWorkflowPollingData,
    isLoading: false,
    error: null,
    clearWorkflowData: vi.fn(),
    isPolling: false,
    refetch: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessagesResponse(overrides: {
  workflowStatus?: string;
  stakworkProjectId?: number | null;
} = {}) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        task: {
          id: "task-abc",
          title: "Test Task",
          description: null,
          status: "TODO",
          workflowStatus: overrides.workflowStatus ?? "PENDING",
          stakworkProjectId: overrides.stakworkProjectId ?? null,
          workspaceId: "ws-1",
        },
        messages: [],
        count: 0,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskChatPage — reconciliation polling", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnWorkflowStatusUpdate = null;
    mockWorkflowPollingData = null;
    global.fetch = mockFetch;
  });

  it("starts reconciliation when task loads with IN_PROGRESS + stakworkProjectId", async () => {
    mockFetch.mockResolvedValue(
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 42 })
    );

    const { useWorkflowPolling } = await import("@/hooks/useWorkflowPolling");
    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-abc/messages")
      );
    });

    // useWorkflowPolling should have been called with isActive=true
    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      const reconcilingCall = calls.find(
        ([projectId, isActive]: [string | null, boolean]) =>
          projectId === "42" && isActive === true
      );
      expect(reconcilingCall).toBeDefined();
    });
  });

  it("does not start reconciliation when task loads with COMPLETED status", async () => {
    mockFetch.mockResolvedValue(
      makeMessagesResponse({ workflowStatus: "COMPLETED", stakworkProjectId: 42 })
    );

    const { useWorkflowPolling } = await import("@/hooks/useWorkflowPolling");
    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-abc/messages")
      );
    });

    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      // All reconciliation calls should have isActive=false
      const activeReconciliationCall = calls.find(
        ([projectId, isActive]: [string | null, boolean]) =>
          projectId !== null && isActive === true
      );
      expect(activeReconciliationCall).toBeUndefined();
    });
  });

  it("does not start reconciliation when IN_PROGRESS but no stakworkProjectId", async () => {
    mockFetch.mockResolvedValue(
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: null })
    );

    const { useWorkflowPolling } = await import("@/hooks/useWorkflowPolling");
    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-abc/messages")
      );
    });

    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      // projectId should be null since there's no stakworkProjectId
      const activeWithProjectId = calls.find(
        ([projectId, isActive]: [string | null, boolean]) =>
          projectId !== null && isActive === true
      );
      expect(activeWithProjectId).toBeUndefined();
    });
  });

  it("patches workflowStatus to COMPLETED and stops reconciling when polling returns 'completed'", async () => {
    // Page loads with IN_PROGRESS
    mockFetch.mockResolvedValueOnce(
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 42 })
    );
    // PATCH call
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    // Simulate polling returning completed
    mockWorkflowPollingData = {
      status: "completed",
      workflowData: { transitions: [], connections: [] },
    };

    const { useWorkflowPolling } = await import("@/hooks/useWorkflowPolling");
    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        ([url, opts]: [string, RequestInit]) =>
          typeof url === "string" &&
          url.includes("/api/tasks/task-abc") &&
          opts?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.workflowStatus).toBe("COMPLETED");
    });

    // After PATCH, reconciliation should stop — isActive should become false
    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      // isActive (second arg) should be false after terminal state received
      expect(lastCall[1]).toBe(false);
    });
  });

  it("patches workflowStatus to FAILED and stops reconciling when polling returns 'failed'", async () => {
    mockFetch.mockResolvedValueOnce(
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 99 })
    );
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    mockWorkflowPollingData = {
      status: "failed",
      workflowData: { transitions: [], connections: [] },
    };

    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        ([url, opts]: [string, RequestInit]) =>
          typeof url === "string" &&
          url.includes("/api/tasks/task-abc") &&
          opts?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.workflowStatus).toBe("FAILED");
    });
  });

  it("stops reconciliation when Pusher WORKFLOW_STATUS_UPDATE fires, with no extra PATCH", async () => {
    // Task loads with IN_PROGRESS — reconciliation starts
    mockFetch.mockResolvedValueOnce(
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 77 })
    );

    // No terminal polling data — reconciliation is active but hasn't resolved yet
    mockWorkflowPollingData = null;

    const { useWorkflowPolling } = await import("@/hooks/useWorkflowPolling");
    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-abc/messages")
      );
    });

    // Confirm reconciliation is active
    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      const activeCall = calls.find(
        ([projectId, isActive]: [string | null, boolean]) =>
          projectId === "77" && isActive === true
      );
      expect(activeCall).toBeDefined();
    });

    const fetchCountBeforePusher = mockFetch.mock.calls.length;

    // Simulate Pusher delivering WORKFLOW_STATUS_UPDATE
    act(() => {
      capturedOnWorkflowStatusUpdate?.({ workflowStatus: "COMPLETED" });
    });

    // After Pusher fires, reconciliation should be stopped (isActive=false in next render)
    await waitFor(() => {
      const calls = (useWorkflowPolling as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toBe(false);
    });

    // No extra PATCH should have been fired by reconciliation
    const patchCallsAfterPusher = mockFetch.mock.calls
      .slice(fetchCountBeforePusher)
      .filter(
        ([url, opts]: [string, RequestInit]) =>
          typeof url === "string" &&
          url.includes("/api/tasks/task-abc") &&
          opts?.method === "PATCH"
      );
    expect(patchCallsAfterPusher).toHaveLength(0);
  });
});
