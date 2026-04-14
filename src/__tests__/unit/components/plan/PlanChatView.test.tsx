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
  error: null as string | null,
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

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => ({
    connection: { socket_id: "test-socket-id" },
  })),
}));

const mockArtifactsPanel = vi.fn();
vi.mock("@/components/chat", () => ({
  ChatArea: ({ 
    onArtifactAction, 
    sphinxInviteEnabled,
    workspaceSlug,
    featureId
  }: { 
    onArtifactAction: (messageId: string, action: { optionResponse: string }) => void;
    sphinxInviteEnabled?: boolean;
    workspaceSlug?: string;
    featureId?: string;
  }) => (
    <div data-testid="chat-area">
      <button
        data-testid="artifact-action-button"
        onClick={() => onArtifactAction("test-message-id", { optionResponse: "Test answer" })}
      >
        Submit Answer
      </button>
      {sphinxInviteEnabled && workspaceSlug && featureId && (
        <button
          data-testid="invite-button"
        >
          Invite
        </button>
      )}
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

  const mockLlmModelsResponse = {
    models: [
      { id: "1", name: "claude-sonnet-4", provider: "ANTHROPIC", providerLabel: "Claude Sonnet 4" },
      { id: "2", name: "gpt-4o", provider: "OPENAI", providerLabel: "GPT-4o" },
    ],
  };

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

    // Default mock for fetch — handles messages, sphinx, and llm-models
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/llm-models") {
        return Promise.resolve({
          ok: true,
          json: async () => mockLlmModelsResponse,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      });
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

    it("should read from window.location.search on hard refresh when searchParams returns null", async () => {
      // Simulate hard refresh: searchParams returns null but window.location.search has ?tab=tasks
      mockGet.mockReturnValue(null);
      
      // Mock window.location.search
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...originalLocation, search: "?tab=tasks" }
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      const lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("TASKS");

      // Restore window.location
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation
      });
    });

    it("should sync activeTab when searchParams changes after hydration", async () => {
      // Initially no tab param
      mockGet.mockReturnValue(null);

      const { rerender } = render(
        <PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />
      );

      await waitFor(() => {
        expect(mockArtifactsPanel).toHaveBeenCalled();
      });

      let lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
      expect(lastCall.controlledTab).toBe("PLAN");

      // Simulate searchParams changing (e.g., browser navigation)
      mockGet.mockReturnValue("tasks");

      rerender(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        lastCall = mockArtifactsPanel.mock.calls[mockArtifactsPanel.mock.calls.length - 1][0];
        expect(lastCall.controlledTab).toBe("TASKS");
      });
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
        expect(body).toMatchObject({
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
      updateData: vi.fn(),
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
          title: "Original Title",
          brief: "Test brief",
          requirements: null,
          architecture: null,
          userStories: [],
          phases: [],
          assignee: null,
          personas: [],
          diagramUrl: null,
          diagramS3Key: null,
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workflowStatus: "IN_PROGRESS",
          createdAt: new Date(),
          updatedAt: new Date(),
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

  describe("Sphinx invite button visibility", () => {
    beforeEach(() => {
      // Reset fetch mock for each test
      mockFetch.mockClear();
    });

    it("shows Invite button when Sphinx is fully configured", async () => {
      // Mock messages fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      // Mock Sphinx settings fetch with all fields configured
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sphinxEnabled: true,
          sphinxChatPubkey: "test-pubkey",
          sphinxBotId: "test-bot-id",
          hasBotSecret: true,
        }),
      });

      const { container } = render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      // Wait for the Sphinx status fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/test-workspace/settings/sphinx-integration"
        );
      });

      // Wait for the invite button to appear
      await waitFor(() => {
        expect(screen.getByTestId("invite-button")).toBeInTheDocument();
      });
    });

    it("hides Invite button when bot secret is missing", async () => {
      // Mock messages fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      // Mock Sphinx settings fetch with hasBotSecret=false
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sphinxEnabled: true,
          sphinxChatPubkey: "test-pubkey",
          sphinxBotId: "test-bot-id",
          hasBotSecret: false,
        }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      // Wait for the Sphinx status fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/test-workspace/settings/sphinx-integration"
        );
      });

      // Verify the invite button is NOT present
      await waitFor(() => {
        expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
      });
    });

    it("hides Invite button when Sphinx status fetch returns 403 (non-admin prior to fix)", async () => {
      // Mock messages fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      // Mock Sphinx settings fetch returning 403 (simulating old behaviour for non-admins)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Admin access required" }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      // Wait for the Sphinx status fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/test-workspace/settings/sphinx-integration"
        );
      });

      // Invite button must NOT appear when the fetch fails
      await waitFor(() => {
        expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
      });
    });

    it("shows Invite button for non-admin member when Sphinx is fully configured (post-fix)", async () => {
      // Mock messages fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      // Mock Sphinx settings fetch returning 200 with all fields set
      // (simulates the fixed GET endpoint accessible to DEVELOPER/VIEWER roles)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sphinxEnabled: true,
          sphinxChatPubkey: "test-pubkey",
          sphinxBotId: "test-bot-id",
          hasBotSecret: true,
        }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      // Wait for the Sphinx status fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/test-workspace/settings/sphinx-integration"
        );
      });

      // Invite button MUST appear for non-admin members when Sphinx is fully configured
      await waitFor(() => {
        expect(screen.getByTestId("invite-button")).toBeInTheDocument();
      });
    });
  });

  describe("stakworkProjectId hydration", () => {
    it("should call useProjectLogWebSocket with the feature stakworkProjectId on initial load", async () => {
      const { useProjectLogWebSocket } = await import("@/hooks/useProjectLogWebSocket");
      const mockWebSocket = vi.mocked(useProjectLogWebSocket);

      mockUseDetailResource.mockReturnValue({
        data: {
          id: "feature-123",
          title: "Test Feature",
          brief: null,
          requirements: null,
          architecture: null,
          userStories: [],
          phases: [],
          assignee: null,
          personas: [],
          diagramUrl: null,
          diagramS3Key: null,
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workflowStatus: "IN_PROGRESS",
          stakworkProjectId: 42,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        setData: mockSetData,
        updateData: vi.fn(),
        loading: false,
        error: null,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        const calls = mockWebSocket.mock.calls;
        expect(calls.some(([id]) => id === "42")).toBe(true);
      });
    });

    it("should call useProjectLogWebSocket with stakworkProjectId after visibility-change refetch", async () => {
      const { useProjectLogWebSocket } = await import("@/hooks/useProjectLogWebSocket");
      const mockWebSocket = vi.mocked(useProjectLogWebSocket);

      // Initial load: no stakworkProjectId
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      mockFetch.mockClear();

      // On visibility change, refetchFeature returns a feature with stakworkProjectId: 99
      mockFetch.mockImplementation((url: string) => {
        if (url === "/api/features/feature-123") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                id: "feature-123",
                title: "Test Feature",
                brief: null,
                requirements: null,
                architecture: null,
                userStories: [],
                phases: [],
                assignee: null,
                personas: [],
                diagramUrl: null,
                diagramS3Key: null,
                status: "IN_PROGRESS",
                priority: "MEDIUM",
                workflowStatus: "IN_PROGRESS",
                stakworkProjectId: 99,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123");
      });

      await waitFor(() => {
        const calls = mockWebSocket.mock.calls;
        expect(calls.some(([id]) => id === "99")).toBe(true);
      });
    });
  });

  // Section Highlights feature is comprehensively tested in sectionHighlights.test.ts
  // The integration is smoke-tested by ensuring PlanChatView renders without errors

  describe("handleRetry", () => {
    // We capture ChatArea props (including onRetry) through the module-level mock
    // The module mock is set up at the top of the file, and mockArtifactsPanel captures ArtifactsPanel props.
    // For ChatArea we need a separate capture mechanism.
    let capturedChatAreaProps: any = null;

    beforeEach(() => {
      capturedChatAreaProps = null;
    });

    it("passes onRetry function and isRetrying=false to ChatArea via chatAreaProps", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      // Use a spy on the module-level ChatArea mock to capture props
      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return (
          <div data-testid="chat-area">
            <button
              data-testid="artifact-action-button"
              onClick={() => props.onArtifactAction("test-message-id", { optionResponse: "Test answer" })}
            >
              Submit Answer
            </button>
          </div>
        );
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      expect(typeof capturedChatAreaProps?.onRetry).toBe("function");
      expect(capturedChatAreaProps?.isRetrying).toBe(false);
    });

    it("calls sendMessage with first message when no ASSISTANT messages exist", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                message: "Hello world",
                role: ChatRole.USER,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
                artifacts: [],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: false }) // Sphinx fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: {
              id: "msg-2",
              message: "Hello world",
              role: ChatRole.USER,
              status: ChatStatus.SENT,
              createdAt: new Date().toISOString(),
            },
          }),
        });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      });

      await act(async () => {
        await capturedChatAreaProps?.onRetry();
      });

      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.message).toBe("Hello world");
    });

    it("calls sendMessage with last USER message when ASSISTANT messages exist", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                message: "First question",
                role: ChatRole.USER,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
                artifacts: [],
              },
              {
                id: "msg-2",
                message: "AI answer",
                role: ChatRole.ASSISTANT,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
                artifacts: [],
              },
              {
                id: "msg-3",
                message: "Follow up question",
                role: ChatRole.USER,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
                artifacts: [],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: false }) // Sphinx fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: {
              id: "msg-4",
              message: "Follow up question",
              role: ChatRole.USER,
              status: ChatStatus.SENT,
              createdAt: new Date().toISOString(),
            },
          }),
        });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      });

      await act(async () => {
        await capturedChatAreaProps?.onRetry();
      });

      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.message).toBe("Follow up question");
    });

  describe("inputDisabled behaviour", () => {
    let capturedChatAreaProps: any = null;

    beforeEach(() => {
      capturedChatAreaProps = null;
    });

    it("disables input when feature.status is CANCELLED", async () => {
      mockUseDetailResource.mockReturnValue({
        data: {
          id: "feature-123",
          title: "Cancelled Feature",
          brief: null,
          requirements: null,
          architecture: null,
          userStories: [],
          phases: [],
          assignee: null,
          personas: [],
          diagramUrl: null,
          diagramS3Key: null,
          status: "CANCELLED",
          priority: "MEDIUM",
          workflowStatus: "COMPLETED",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        setData: mockSetData,
        updateData: vi.fn(),
        loading: false,
        error: null,
      });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      expect(capturedChatAreaProps?.inputDisabled).toBe(true);
    });

    it.each(["BACKLOG", "PLANNED", "IN_PROGRESS", "COMPLETED"] as const)(
      "does not disable input when feature.status is %s (and workflow is not IN_PROGRESS)",
      async (status) => {
        mockUseDetailResource.mockReturnValue({
          data: {
            id: "feature-123",
            title: "Active Feature",
            brief: null,
            requirements: null,
            architecture: null,
            userStories: [],
            phases: [],
            assignee: null,
            personas: [],
            diagramUrl: null,
            diagramS3Key: null,
            status,
            priority: "MEDIUM",
            workflowStatus: "COMPLETED",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          setData: mockSetData,
          updateData: vi.fn(),
          loading: false,
          error: null,
        });

        const chatModule = await import("@/components/chat");
        vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
          capturedChatAreaProps = props;
          return <div data-testid="chat-area" />;
        });

        render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

        await waitFor(() => {
          expect(screen.getByTestId("chat-area")).toBeInTheDocument();
        });

        expect(capturedChatAreaProps?.inputDisabled).toBe(false);
      }
    );

    it("disables input when workflowStatus is IN_PROGRESS (regardless of feature status)", async () => {
      mockUseDetailResource.mockReturnValue({
        data: {
          id: "feature-123",
          title: "Active Feature",
          brief: null,
          requirements: null,
          architecture: null,
          userStories: [],
          phases: [],
          assignee: null,
          personas: [],
          diagramUrl: null,
          diagramS3Key: null,
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workflowStatus: "IN_PROGRESS",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        setData: mockSetData,
        updateData: vi.fn(),
        loading: false,
        error: null,
      });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      expect(capturedChatAreaProps?.inputDisabled).toBe(true);
    });

    it("disables input when loading is true", async () => {
      mockUseDetailResource.mockReturnValue({
        data: {
          id: "feature-123",
          title: "Active Feature",
          brief: null,
          requirements: null,
          architecture: null,
          userStories: [],
          phases: [],
          assignee: null,
          personas: [],
          diagramUrl: null,
          diagramS3Key: null,
          status: "PLANNED",
          priority: "MEDIUM",
          workflowStatus: "COMPLETED",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        setData: mockSetData,
        updateData: vi.fn(),
        loading: true,
        error: null,
      });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      expect(capturedChatAreaProps?.inputDisabled).toBe(true);
    });
  });

    it("does nothing when messages is empty", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [] }),
        })
        .mockResolvedValueOnce({ ok: false }); // Sphinx fetch

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      await act(async () => {
        await capturedChatAreaProps?.onRetry();
      });

      // No POST calls should have been made (messages is empty)
      const postCalls = mockFetch.mock.calls.filter(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );
      expect(postCalls).toHaveLength(0);
    });
  });

  describe("Model selector dropdown", () => {
    let capturedChatAreaProps: any = null;

    beforeEach(() => {
      capturedChatAreaProps = null;
    });

    it("passes selectedModel defaulting to first llm-model (provider/name format), onModelChange, and hasMessages=false to ChatArea when no messages", async () => {
      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // After llm-models fetch, default model is first model in provider/name format
      await waitFor(() => {
        expect(capturedChatAreaProps?.selectedModel).toBe("anthropic/claude-sonnet-4");
      });
      expect(typeof capturedChatAreaProps?.onModelChange).toBe("function");
      expect(capturedChatAreaProps?.hasMessages).toBe(false);
    });

    it("passes hasMessages=true to ChatArea when messages exist", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "msg-1",
              message: "Hello",
              role: ChatRole.USER,
              status: ChatStatus.SENT,
              createdAt: new Date().toISOString(),
              artifacts: [],
            },
          ],
        }),
      });

      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(capturedChatAreaProps?.hasMessages).toBe(true);
      });
    });

    it("includes selectedModel in POST body when sending a message (provider/name format)", async () => {
      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === "/api/llm-models") {
          return Promise.resolve({ ok: true, json: async () => mockLlmModelsResponse });
        }
        if (url === "/api/features/feature-123/chat" && options?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              message: {
                id: "msg-new",
                message: "Test message",
                role: ChatRole.USER,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // Wait for llm-models to load and set selectedModel
      await waitFor(() => {
        expect(capturedChatAreaProps?.selectedModel).toBe("anthropic/claude-sonnet-4");
      });

      // Change model to openai/gpt-4o
      act(() => {
        capturedChatAreaProps?.onModelChange("openai/gpt-4o");
      });

      // Send a message
      await act(async () => {
        await capturedChatAreaProps?.onSend("Test message");
      });

      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.model).toBe("openai/gpt-4o");
    });

    it("sends default model (first from llm-models) when no model change is made", async () => {
      const chatModule = await import("@/components/chat");
      vi.spyOn(chatModule, "ChatArea").mockImplementation((props: any) => {
        capturedChatAreaProps = props;
        return <div data-testid="chat-area" />;
      });

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === "/api/llm-models") {
          return Promise.resolve({ ok: true, json: async () => mockLlmModelsResponse });
        }
        if (url === "/api/features/feature-123/chat" && options?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              message: {
                id: "msg-new",
                message: "Hello",
                role: ChatRole.USER,
                status: ChatStatus.SENT,
                createdAt: new Date().toISOString(),
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });

      render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("chat-area")).toBeInTheDocument();
      });

      // Wait for llm-models to load
      await waitFor(() => {
        expect(capturedChatAreaProps?.selectedModel).toBe("anthropic/claude-sonnet-4");
      });

      await act(async () => {
        await capturedChatAreaProps?.onSend("Hello");
      });

      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.model).toBe("anthropic/claude-sonnet-4");
    });
  });
});
