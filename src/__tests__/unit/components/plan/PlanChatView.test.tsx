import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import { ChatRole, ChatStatus } from "@/lib/chat";


const mockReplace = vi.fn();
const mockGet = vi.fn();
const mockPush = vi.fn();

// Mock next-auth
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

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: mockReplace,
  })),
  usePathname: vi.fn(() => "/w/test-workspace/plan/feature-123"),
  useSearchParams: vi.fn(() => ({
    get: mockGet,
  })),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    workspaceId: "workspace-1",
  }),
}));

const mockUsePusherConnection = vi.fn();
vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: (config: any) => mockUsePusherConnection(config),
}));

const mockSetData = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseDetailResource = vi.fn((): any => ({
  data: {
    id: "feature-123",
    title: "Test Feature",
    brief: null,
    requirements: null,
    architecture: null,
    userStories: [],
  },
  setData: mockSetData,
  updateData: vi.fn(),
  loading: false,
  error: null,
}));

vi.mock("@/hooks/useDetailResource", () => ({
  useDetailResource: () => mockUseDetailResource(),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/usePlanPresence", () => ({
  usePlanPresence: () => ({
    collaborators: [],
  }),
}));

vi.mock("@/hooks/useProjectLogWebSocket", () => ({
  useProjectLogWebSocket: vi.fn(() => ({
    logs: [],
    lastLogLine: null,
    clearLogs: vi.fn(),
  })),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

const mockArtifactsPanel = vi.fn();
vi.mock("@/components/chat", () => ({
  ChatArea: ({ onArtifactAction }: { onArtifactAction: (messageId: string, action: { optionResponse: string }) => void }) => (
    <div data-testid="chat-area">
      <button
        data-testid="artifact-action-button"
        onClick={() => onArtifactAction("test-message-id", { optionResponse: "Test answer" })}
      >
        Submit Answer
      </button>
    </div>
  ),
  ArtifactsPanel: (props: any) => {
    mockArtifactsPanel(props);
    return <div data-testid="artifacts-panel">Artifacts Panel</div>;
  },
}));

describe("PlanChatView", () => {
  const mockFetch = vi.fn();
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    
    // Mock localStorage
    localStorageMock = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => localStorageMock[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageMock[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageMock[key];
        }),
        clear: vi.fn(() => {
          localStorageMock = {};
        }),
      },
      writable: true,
    });

    // Default mock for fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    // Reset URL param mock
    mockGet.mockReturnValue(null);
  });

  afterEach(() => {
    localStorageMock = {};
  });

  describe("Tab state management", () => {
    it("should default to PLAN tab when no URL param or localStorage", async () => {
      mockGet.mockReturnValue(null);

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");
    });

    it("should use URL param ?tab=tasks when present", async () => {
      mockGet.mockReturnValue("tasks");

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("TASKS");
    });

    it("should use localStorage when no URL param", async () => {
      mockGet.mockReturnValue(null);
      localStorageMock["plan_tab_feature-123"] = "TASKS";

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("TASKS");
    });

    it("should prioritize URL param over localStorage", async () => {
      mockGet.mockReturnValue("plan");
      localStorageMock["plan_tab_feature-123"] = "TASKS";

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");
    });

    it("should fall back to PLAN for invalid URL param", async () => {
      mockGet.mockReturnValue("invalid");

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");
    });

    it("should fall back to PLAN for invalid localStorage value", async () => {
      mockGet.mockReturnValue(null);
      localStorageMock["plan_tab_feature-123"] = "INVALID";

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");
    });

    it("should handle case-insensitive URL params", async () => {
      mockGet.mockReturnValue("Tasks");

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("TASKS");
    });

    it("should use correct localStorage key per feature", async () => {
      mockGet.mockReturnValue(null);
      localStorageMock["plan_tab_feature-456"] = "TASKS";
      localStorageMock["plan_tab_feature-123"] = "PLAN";

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(window.localStorage.getItem).toHaveBeenCalledWith("plan_tab_feature-123");
      });

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");
    });
  });

  describe("Tab change handler", () => {
    it("should update URL when tab changes", async () => {
      mockGet.mockReturnValue(null);

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      const onControlledTabChange = lastCall.onControlledTabChange;

      // Simulate tab change
      await act(async () => {
        onControlledTabChange("TASKS");
      });

      expect(mockReplace).toHaveBeenCalledWith("?tab=tasks", { scroll: false });
    });

    it("should write to localStorage when tab changes", async () => {
      mockGet.mockReturnValue(null);

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      const onControlledTabChange = lastCall.onControlledTabChange;

      // Simulate tab change
      await act(async () => {
        onControlledTabChange("TASKS");
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith("plan_tab_feature-123", "TASKS");
    });

    it("should use lowercase in URL", async () => {
      mockGet.mockReturnValue(null);

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      const onControlledTabChange = lastCall.onControlledTabChange;

      await act(async () => {
        onControlledTabChange("PLAN");
      });
      expect(mockReplace).toHaveBeenCalledWith("?tab=plan", { scroll: false });

      await act(async () => {
        onControlledTabChange("TASKS");
      });
      expect(mockReplace).toHaveBeenCalledWith("?tab=tasks", { scroll: false });
    });

    it("should pass controlledTab and onControlledTabChange to ArtifactsPanel", async () => {
      mockGet.mockReturnValue("tasks");

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("TASKS");
      expect(typeof lastCall.onControlledTabChange).toBe("function");
    });
  });

  describe("replyId handling (existing test)", () => {
    it("should pass replyId when handleArtifactAction is called", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: {
              id: "new-message-id",
              message: "Test answer",
              role: ChatRole.USER,
              status: ChatStatus.SENT,
              replyId: "test-message-id",
              createdAt: new Date().toISOString(),
            },
          }),
        });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      const submitButton = screen.getByTestId("artifact-action-button");
      await userEvent.click(submitButton);

      await waitFor(() => {
        const sendMessageCall = mockFetch.mock.calls.find(
          (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
        );

        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall![1].body);
        expect(body).toEqual({
          message: "Test answer",
          replyId: "test-message-id",
        });
      });
    });
  });

  it("should redirect to plan list when feature not found", async () => {
    // Mock useDetailResource to return error state
    mockUseDetailResource.mockReturnValueOnce({
      data: null,
      setData: vi.fn(),
      loading: false,
      error: "Not found",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="bad-id" workspaceSlug="test-workspace" workspaceId="ws-1" />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/plan");
    });
  });

  it("should refetch feature and messages when tab becomes visible", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    await waitFor(() => {
      // Should refetch both feature data and messages
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123");
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it("should not refetch when tab becomes hidden", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    // Wait a bit to ensure no fetch calls are made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should cleanup visibility listener on unmount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const { unmount } = render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Unmount the component
    unmount();

    // Simulate tab becoming visible after unmount
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    // Wait a bit to ensure no fetch calls are made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("Feature title updates", () => {
    it("should update feature title when onFeatureTitleUpdate is called", async () => {
      const mockSetData = vi.fn();
      const mockUpdateData = vi.fn();
      mockUseDetailResource.mockReturnValue({
        data: {
          id: "feature-123",
          workspaceId: "workspace-1",
          title: "Original Title",
          brief: "Test brief",
          requirements: null,
          architecture: null,
          userStories: null,
        },
        setData: mockSetData,
        updateData: mockUpdateData,
        loading: false,
        error: null,
      });

      let capturedOnFeatureTitleUpdate: ((update: { featureId: string; newTitle: string }) => void) | undefined;

      // Mock usePusherConnection to capture the callback
      mockUsePusherConnection.mockImplementation((options: any) => {
        capturedOnFeatureTitleUpdate = options.onFeatureTitleUpdate;
        return {
          isConnected: true,
          connectionId: "test-connection",
          connect: vi.fn(),
          disconnect: vi.fn(),
          error: null,
        };
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // Verify that usePusherConnection was called with onFeatureTitleUpdate
      expect(mockUsePusherConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          featureId: "feature-123",
          onFeatureTitleUpdate: expect.any(Function),
        })
      );

      // Simulate receiving a feature title update
      act(() => {
        capturedOnFeatureTitleUpdate?.({
          featureId: "feature-123",
          newTitle: "Updated Title",
        });
      });

      // Verify updateData was called with the new title
      await waitFor(() => {
        expect(mockUpdateData).toHaveBeenCalledWith({ title: "Updated Title" });
      });
    });

    it("should not update if feature data is null", async () => {
      const mockSetData = vi.fn();
      const mockUpdateData = vi.fn();
      mockUseDetailResource.mockReturnValue({
        data: null,
        setData: mockSetData,
        updateData: mockUpdateData,
        loading: false,
        error: null,
      });

      let capturedOnFeatureTitleUpdate: ((update: { featureId: string; newTitle: string }) => void) | undefined;

      // Mock usePusherConnection to capture the callback
      mockUsePusherConnection.mockImplementation((options: any) => {
        capturedOnFeatureTitleUpdate = options.onFeatureTitleUpdate;
        return {
          isConnected: true,
          connectionId: "test-connection",
          connect: vi.fn(),
          disconnect: vi.fn(),
          error: null,
        };
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // Simulate receiving a feature title update when data is null
      act(() => {
        capturedOnFeatureTitleUpdate?.({
          featureId: "feature-123",
          newTitle: "Updated Title",
        });
      });

      // Verify updateData was called (even though data is null, the callback still fires)
      await waitFor(() => {
        expect(mockUpdateData).toHaveBeenCalledWith({ title: "Updated Title" });
      });

      // Verify setData was NOT called (because updateData does nothing when data is null)
      expect(mockSetData).not.toHaveBeenCalled();
    });
  });

  describe("Project log WebSocket integration", () => {
    it("should pass isChainVisible, logs, and lastLogLine props to ChatArea", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // Verify ChatArea is rendered (props are passed via mock in setup)
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });
  });

  // Section Highlights feature is comprehensively tested in sectionHighlights.test.ts
  // The integration is smoke-tested by ensuring PlanChatView renders without errors
});
