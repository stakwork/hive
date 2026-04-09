import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useWhiteboardCollaboration } from "@/hooks/useWhiteboardCollaboration";

const mockChannel = {
  bind: vi.fn(),
  unbind_all: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

const mockExcalidrawAPI = {
  updateScene: vi.fn(),
  getSceneElements: vi.fn(() => []),
  getAppState: vi.fn(() => ({ viewBackgroundColor: "#ffffff" })),
};

const mockSession = {
  data: {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      image: "https://example.com/avatar.jpg",
    },
    expires: "2099-01-01",
  },
  status: "authenticated" as const,
};

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => mockSession),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getWhiteboardChannelName: vi.fn((whiteboardId: string) => `whiteboard-${whiteboardId}`),
  PUSHER_EVENTS: {
    WHITEBOARD_ELEMENTS_UPDATE: "whiteboard-elements-update",
    WHITEBOARD_CURSOR_UPDATE: "whiteboard-cursor-update",
    WHITEBOARD_USER_JOIN: "whiteboard-user-join",
    WHITEBOARD_USER_LEAVE: "whiteboard-user-leave",
  },
}));

global.fetch = vi.fn();
navigator.sendBeacon = vi.fn();

describe("useWhiteboardCollaboration", () => {
  const whiteboardId = "whiteboard-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("COLLABORATION_ENABLED flag", () => {
    it("should subscribe to Pusher channel when NEXT_PUBLIC_WHITEBOARD_COLLABORATION is not set to 'false'", async () => {
      // Ensure the env var is not "false" (default / absent)
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      expect(pusher.getPusherClient).toHaveBeenCalled();
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`whiteboard-${whiteboardId}`);
    });

    it("should subscribe to Pusher channel when NEXT_PUBLIC_WHITEBOARD_COLLABORATION is absent", async () => {
      // env var absent → collaboration enabled
      delete process.env.NEXT_PUBLIC_WHITEBOARD_COLLABORATION;

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      expect(pusher.getPusherClient).toHaveBeenCalled();
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith(`whiteboard-${whiteboardId}`);
    });

    it("should not subscribe to Pusher and broadcastElements/broadcastCursor should be no-ops when NEXT_PUBLIC_WHITEBOARD_COLLABORATION is 'false'", async () => {
      // COLLABORATION_ENABLED is a module-level constant, so we must reset the
      // module registry and re-import the hook after stubbing the env var so
      // it re-evaluates with the new value.
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "false");
      vi.resetModules();

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      const { useWhiteboardCollaboration: hook } = await import(
        "@/hooks/useWhiteboardCollaboration"
      );

      const { result } = renderHook(() =>
        hook({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      // No Pusher subscription
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();

      // broadcastElements should be a no-op (no fetch)
      act(() => {
        result.current.broadcastElements([], {} as any);
      });
      expect(global.fetch).not.toHaveBeenCalled();

      // broadcastCursor should be a no-op (no fetch)
      act(() => {
        result.current.broadcastCursor(10, 20);
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle getPusherClient throwing error gracefully", async () => {
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      
      // Mock getPusherClient to throw
      vi.mocked(pusher.getPusherClient).mockImplementation(() => {
        throw new Error("Pusher environment variables are not configured");
      });

      // Hook should render without error
      expect(() => {
        renderHook(() =>
          useWhiteboardCollaboration({
            whiteboardId,
            excalidrawAPI: mockExcalidrawAPI as any,
          })
        );
      }).not.toThrow();

      // No subscription should be attempted
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(mockChannel.bind).not.toHaveBeenCalled();
    });
  });
});
