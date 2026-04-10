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

  describe("WHITEBOARD_CURSOR_UPDATE", () => {
    it("should call updateScene with collaborators Map on cursor event", async () => {
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      // Capture bound event handlers
      const handlers: Record<string, (data: unknown) => void> = {};
      vi.mocked(mockChannel.bind).mockImplementation((event: string, handler: (data: unknown) => void) => {
        handlers[event] = handler;
        return mockChannel;
      });

      renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      // Simulate a WHITEBOARD_CURSOR_UPDATE event from another user
      act(() => {
        handlers["whiteboard-cursor-update"]?.({
          senderId: "other-user-abc",
          cursor: { x: 150, y: 250 },
          color: "#FF6B6B",
          username: "Alice",
        });
      });

      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalled();
      const call = mockExcalidrawAPI.updateScene.mock.calls[mockExcalidrawAPI.updateScene.mock.calls.length - 1][0];
      expect(call).toHaveProperty("collaborators");
      const collaboratorsMap = call.collaborators as Map<string, unknown>;
      expect(collaboratorsMap).toBeInstanceOf(Map);
      expect(collaboratorsMap.has("other-user-abc")).toBe(true);
      const entry = collaboratorsMap.get("other-user-abc") as { username: string; pointer: { x: number; y: number; tool: string }; color: { background: string; stroke: string } };
      expect(entry.username).toBe("Alice");
      expect(entry.pointer).toEqual({ x: 150, y: 250, tool: "pointer" });
      expect(entry.color).toEqual({ background: "#FF6B6B", stroke: "#FF6B6B" });
    });

    it("should ignore cursor events from the current user (senderId match)", async () => {
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      const handlers: Record<string, (data: unknown) => void> = {};
      vi.mocked(mockChannel.bind).mockImplementation((event: string, handler: (data: unknown) => void) => {
        handlers[event] = handler;
        return mockChannel;
      });

      const { result } = renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      const ownSenderId = result.current.senderId;

      act(() => {
        handlers["whiteboard-cursor-update"]?.({
          senderId: ownSenderId,
          cursor: { x: 10, y: 20 },
          color: "#FF6B6B",
          username: "Self",
        });
      });

      // updateScene should not have been called for own cursor events
      expect(mockExcalidrawAPI.updateScene).not.toHaveBeenCalled();
    });
  });

  describe("WHITEBOARD_USER_LEAVE clears cursor", () => {
    it("should remove departing user's cursor and call updateScene with empty collaborators", async () => {
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      const handlers: Record<string, (data: unknown) => void> = {};
      vi.mocked(mockChannel.bind).mockImplementation((event: string, handler: (data: unknown) => void) => {
        handlers[event] = handler;
        return mockChannel;
      });

      renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        })
      );

      // First, add a cursor for the user
      act(() => {
        handlers["whiteboard-cursor-update"]?.({
          senderId: "leaving-user-xyz",
          cursor: { x: 100, y: 200 },
          color: "#4ECDC4",
          username: "Bob",
        });
      });

      mockExcalidrawAPI.updateScene.mockClear();

      // Now simulate the user leaving
      act(() => {
        handlers["whiteboard-user-leave"]?.({ userId: "leaving-user" });
      });

      // updateScene should have been called to clear cursors
      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalled();
      const call = mockExcalidrawAPI.updateScene.mock.calls[mockExcalidrawAPI.updateScene.mock.calls.length - 1][0];
      const collaboratorsMap = call.collaborators as Map<string, unknown>;
      expect(collaboratorsMap).toBeInstanceOf(Map);
      // "leaving-user-xyz" starts with "leaving-user" so it should be removed
      expect(collaboratorsMap.has("leaving-user-xyz")).toBe(false);
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
