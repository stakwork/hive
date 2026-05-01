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
    ResizableHandle: () => React.createElement("div"),
  };
});

vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    canRead: true,
    canWrite: true,
    canAdmin: false,
    permissions: {},
  }),
}));

vi.mock("@/contexts/StreamContext", () => ({
  useStreamContext: () => ({
    streamContext: null,
    onMessage: vi.fn(),
    onWorkflowStatusUpdate: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const React = require("react");
      return React.createElement("div", props, children);
    },
  },
  AnimatePresence: ({ children }: any) => children,
}));

// ---------------------------------------------------------------------------
// Workflow polling mock — tests can set mockWorkflowPollingData to simulate results
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

  // Per-test URL-keyed response queues. Fetch calls are routed by URL substring.
  // More specific keys should be pushed first so they match before shorter keys.
  const urlQueues: Map<string, Array<{ ok: boolean; json: () => Promise<unknown> }>> = new Map();

  function pushFetchResponse(
    urlSubstring: string,
    response: { ok: boolean; json: () => Promise<unknown> },
  ) {
    if (!urlQueues.has(urlSubstring)) urlQueues.set(urlSubstring, []);
    urlQueues.get(urlSubstring)!.push(response);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnWorkflowStatusUpdate = null;
    mockWorkflowPollingData = null;
    urlQueues.clear();

    // Route fetch calls by URL substring. This avoids FIFO queue conflicts between
    // the /api/llm-models fetch (added for the LLM model selector) and the task
    // messages fetch — both fire on mount.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string") {
        for (const [key, queue] of urlQueues.entries()) {
          if (url.includes(key) && queue.length > 0) {
            return Promise.resolve(queue.shift()!);
          }
        }
        // Fallback by URL pattern
        if (url.includes("/api/llm-models")) {
          return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
        }
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    global.fetch = mockFetch;
  });

  it("starts reconciliation when task loads with IN_PROGRESS + stakworkProjectId", async () => {
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 42 }),
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
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "COMPLETED", stakworkProjectId: 42 }),
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
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: null }),
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
    // Push more-specific URL first so messages fetch matches before the PATCH URL key
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 42 }),
    );
    pushFetchResponse("/api/tasks/task-abc", { ok: true, json: async () => ({}) });

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
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 99 }),
    );
    pushFetchResponse("/api/tasks/task-abc", { ok: true, json: async () => ({}) });

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
    pushFetchResponse(
      "/api/tasks/task-abc/messages",
      makeMessagesResponse({ workflowStatus: "IN_PROGRESS", stakworkProjectId: 77 }),
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
