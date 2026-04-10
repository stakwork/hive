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
    WHITEBOARD_REFETCH: "whiteboard-refetch",
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
    it("should remove the departing user's cursor when their userId matches", async () => {
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

      // senderId follows the `<userId>-<timestamp>-<random>` format used by
      // the production hook.
      const senderId = "leaving-user-1700000000-abc1234";

      // First, add a cursor for the user
      act(() => {
        handlers["whiteboard-cursor-update"]?.({
          senderId,
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

      // updateScene should have been called to clear the departed user's cursor
      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalled();
      const call = mockExcalidrawAPI.updateScene.mock.calls[mockExcalidrawAPI.updateScene.mock.calls.length - 1][0];
      const collaboratorsMap = call.collaborators as Map<string, unknown>;
      expect(collaboratorsMap).toBeInstanceOf(Map);
      expect(collaboratorsMap.has(senderId)).toBe(false);
    });

    it("should NOT remove cursors of users with similar but different IDs (regression: startsWith bug)", async () => {
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

      // Two users whose IDs share a prefix: "user-12" and "user-123".
      const leavingSenderId = "user-12-1700000000-abc1234";
      const stayingSenderId = "user-123-1700000001-def5678";

      act(() => {
        handlers["whiteboard-cursor-update"]?.({
          senderId: leavingSenderId,
          cursor: { x: 10, y: 20 },
          color: "#4ECDC4",
          username: "User12",
        });
        handlers["whiteboard-cursor-update"]?.({
          senderId: stayingSenderId,
          cursor: { x: 30, y: 40 },
          color: "#FF6B6B",
          username: "User123",
        });
      });

      mockExcalidrawAPI.updateScene.mockClear();

      // "user-12" leaves — "user-123" must remain.
      act(() => {
        handlers["whiteboard-user-leave"]?.({ userId: "user-12" });
      });

      const call = mockExcalidrawAPI.updateScene.mock.calls[mockExcalidrawAPI.updateScene.mock.calls.length - 1][0];
      const collaboratorsMap = call.collaborators as Map<string, unknown>;
      expect(collaboratorsMap.has(leavingSenderId)).toBe(false);
      expect(collaboratorsMap.has(stayingSenderId)).toBe(true);
    });
  });

  describe("WHITEBOARD_REFETCH fallback", () => {
    it("debounces refetch events and merges fetched elements into the canvas", async () => {
      vi.useFakeTimers();
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      const handlers: Record<string, (data: unknown) => void> = {};
      vi.mocked(mockChannel.bind).mockImplementation(
        (event: string, handler: (data: unknown) => void) => {
          handlers[event] = handler;
          return mockChannel;
        },
      );

      // Pre-existing local element on the canvas
      const localElement = { id: "el-local", version: 1 };
      (mockExcalidrawAPI.getSceneElements as ReturnType<typeof vi.fn>).mockReturnValue([
        localElement,
      ]);

      // Server response for the refetch fetch — includes a remote element
      const remoteElement = { id: "el-remote", version: 5 };
      vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        // First call is the GET-presence-on-mount; later call is the refetch
        if (url.endsWith(`/api/whiteboards/${whiteboardId}`)) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { elements: [remoteElement] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        }),
      );

      mockExcalidrawAPI.updateScene.mockClear();

      // Fire two refetch events in quick succession
      await act(async () => {
        handlers["whiteboard-refetch"]?.({
          senderId: "other-user-1700-aaa",
          reason: "payload_too_large",
        });
        handlers["whiteboard-refetch"]?.({
          senderId: "other-user-1700-bbb",
          reason: "payload_too_large",
        });
      });

      // Before debounce fires: no fetch for the whiteboard yet
      expect(mockExcalidrawAPI.updateScene).not.toHaveBeenCalled();

      // Advance debounce
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });

      // updateScene called once with the merged result containing both elements
      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalledTimes(1);
      const sceneArg = mockExcalidrawAPI.updateScene.mock.calls[0][0];
      const ids = (sceneArg.elements as Array<{ id: string }>).map((e) => e.id);
      expect(ids).toContain("el-local");
      expect(ids).toContain("el-remote");

      vi.useRealTimers();
    });

    it("ignores refetch events triggered by the current user", async () => {
      vi.useFakeTimers();
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "true");

      const pusher = await import("@/lib/pusher");
      vi.mocked(pusher.getPusherClient).mockReturnValue(mockPusherClient as any);

      const handlers: Record<string, (data: unknown) => void> = {};
      vi.mocked(mockChannel.bind).mockImplementation(
        (event: string, handler: (data: unknown) => void) => {
          handlers[event] = handler;
          return mockChannel;
        },
      );

      const { result } = renderHook(() =>
        useWhiteboardCollaboration({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as any,
        }),
      );

      mockExcalidrawAPI.updateScene.mockClear();

      await act(async () => {
        handlers["whiteboard-refetch"]?.({
          senderId: result.current.senderId,
          reason: "payload_too_large",
        });
        await vi.advanceTimersByTimeAsync(350);
      });

      // Self-originated refetch must not trigger a scene update
      expect(mockExcalidrawAPI.updateScene).not.toHaveBeenCalled();
      vi.useRealTimers();
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
