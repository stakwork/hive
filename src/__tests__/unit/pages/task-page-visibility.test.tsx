import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Make React globally available for components using new JSX transform
if (typeof (global as any).React === 'undefined') {
  (global as any).React = React;
}

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that trigger the component tree
// ---------------------------------------------------------------------------

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
        image: "https://example.com/avatar.jpg",
      },
    },
    status: "authenticated",
  })),
}));

const mockPush = vi.fn();
const mockGet = vi.fn(() => null);
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ slug: "test-workspace", taskParams: ["task-55"] })),
  useSearchParams: vi.fn(() => ({ get: mockGet })),
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn() })),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "workspace-1",
    workspace: { id: "workspace-1", slug: "test-workspace" },
    workspaceId: "workspace-1",
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

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(() => ({
    isConnected: true,
    error: null,
  })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => null),
}));

vi.mock("@/hooks/useChatForm", () => ({
  useChatForm: () => ({ hasActiveChatForm: false, webhook: null }),
}));

const mockUseProjectLogWebSocket = vi.fn(() => ({
  logs: [],
  lastLogLine: null,
  clearLogs: vi.fn(),
}));
vi.mock("@/hooks/useProjectLogWebSocket", () => ({
  useProjectLogWebSocket: (...args: unknown[]) => mockUseProjectLogWebSocket(...args),
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

// Stub heavy child components to keep rendering fast
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
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// ---------------------------------------------------------------------------
// Import the component under test AFTER all mocks are in place
// ---------------------------------------------------------------------------
// NOTE: We use a dynamic import inside each test so the mock for
// useProjectLogWebSocket is fully applied.

describe("Task page — visibilitychange handler", () => {
  const mockFetch = vi.fn();

  const messagesResponse = (stakworkProjectId: number | null = null) => ({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        task: {
          id: "task-55",
          title: "Test Task",
          description: null,
          status: "TODO",
          workflowStatus: "PENDING",
          stakworkProjectId,
          workspaceId: "workspace-1",
        },
        messages: [],
      },
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue(messagesResponse(null));
    // Reset visibilityState
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("calls loadTaskMessages and sets projectId when tab becomes visible", async () => {
    // First call (mount): no stakworkProjectId yet
    mockFetch.mockResolvedValueOnce(messagesResponse(null));
    // Second call (visibilitychange): returns stakworkProjectId 55
    mockFetch.mockResolvedValueOnce(messagesResponse(55));

    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    // Wait for initial messages load
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-55/messages")
      );
    });

    mockFetch.mockClear();

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // fetch should be called again for messages
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-55/messages")
      );
    });

    // useProjectLogWebSocket should eventually be called with "55"
    await waitFor(() => {
      const calls = mockUseProjectLogWebSocket.mock.calls;
      expect(calls.some(([id]) => id === "55")).toBe(true);
    });
  });

  it("does not call loadTaskMessages when tab becomes hidden", async () => {
    mockFetch.mockResolvedValue(messagesResponse(null));

    const { default: TaskChatPage } = await import(
      "@/app/w/[slug]/task/[...taskParams]/page"
    );

    render(<TaskChatPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/task-55/messages")
      );
    });

    mockFetch.mockClear();

    // Simulate tab becoming hidden
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
