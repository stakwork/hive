import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useWhiteboardCollaborationViaRelay } from "@/hooks/useWhiteboardCollaborationViaRelay";

type Handler = (...args: unknown[]) => void;

interface MockSocket {
  id: string;
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: { on: ReturnType<typeof vi.fn> };
  __handlers: Map<string, Handler[]>;
  __fire: (event: string, ...args: unknown[]) => void;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, Handler[]>();
  const socket: MockSocket = {
    id: "socket-abc",
    connected: false,
    __handlers: handlers,
    __fire(event, ...args) {
      const hs = handlers.get(event);
      if (!hs) return;
      for (const h of hs) h(...args);
    },
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return socket;
    }),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    io: { on: vi.fn() },
  };
  return socket;
}

let currentSocket: MockSocket;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => currentSocket),
}));

const mockExcalidrawAPI = {
  updateScene: vi.fn(),
  getSceneElements: vi.fn(() => []),
  getSceneElementsIncludingDeleted: vi.fn(() => []),
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

global.fetch = vi.fn();

describe("useWhiteboardCollaborationViaRelay", () => {
  const whiteboardId = "whiteboard-123";

  beforeEach(() => {
    vi.clearAllMocks();
    currentSocket = createMockSocket();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "signed-jwt",
        url: "https://relay.example.com:3333",
        expiresInSeconds: 300,
      }),
    } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function mountAndConnect() {
    const result = renderHook(() =>
      useWhiteboardCollaborationViaRelay({
        whiteboardId,
        excalidrawAPI: mockExcalidrawAPI as never,
      }),
    );
    await waitFor(() => expect(currentSocket.on).toHaveBeenCalled());
    act(() => {
      currentSocket.connected = true;
      currentSocket.__fire("connect");
    });
    return result;
  }

  describe("COLLABORATION_ENABLED flag", () => {
    it("does not fetch a token when the flag is false", async () => {
      vi.stubEnv("NEXT_PUBLIC_WHITEBOARD_COLLABORATION", "false");

      // Re-import so the module-level constant picks up the stubbed env.
      vi.resetModules();
      const { useWhiteboardCollaborationViaRelay: hook } = await import(
        "@/hooks/useWhiteboardCollaborationViaRelay"
      );

      renderHook(() =>
        hook({ whiteboardId, excalidrawAPI: mockExcalidrawAPI as never }),
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("fetches a relay token and opens a socket when enabled", async () => {
      await mountAndConnect();

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/whiteboards/${whiteboardId}/relay-token`,
      );
      const { io } = await import("socket.io-client");
      expect(io).toHaveBeenCalledWith(
        "https://relay.example.com:3333",
        expect.objectContaining({ auth: { token: "signed-jwt" } }),
      );
    });
  });

  describe("connection lifecycle", () => {
    it("sets isConnected true when the socket connects", async () => {
      const { result } = await mountAndConnect();
      expect(result.current.isConnected).toBe(true);
    });

    it("disconnects the socket on unmount", async () => {
      const { unmount } = await mountAndConnect();
      unmount();
      expect(currentSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe("roster and presence", () => {
    it("populates collaborators from room:roster", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        currentSocket.__fire("room:roster", {
          collaborators: [
            {
              odinguserId: "peer-1",
              name: "Peer One",
              image: null,
              color: "#fff",
              joinedAt: 111,
              senderId: "sid-1",
            },
          ],
        });
      });

      expect(result.current.collaborators).toEqual([
        expect.objectContaining({ odinguserId: "peer-1", name: "Peer One" }),
      ]);
    });

    it("adds a collaborator on user:join", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        currentSocket.__fire("user:join", {
          user: {
            odinguserId: "peer-2",
            name: "Peer Two",
            image: null,
            color: "#000",
            joinedAt: 222,
            senderId: "sid-2",
          },
        });
      });

      expect(result.current.collaborators).toEqual([
        expect.objectContaining({ odinguserId: "peer-2" }),
      ]);
    });

    it("removes a collaborator and their cursor on user:leave", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        currentSocket.__fire("user:join", {
          user: {
            odinguserId: "peer-3",
            name: "Peer Three",
            image: null,
            color: "#abc",
            joinedAt: 333,
            senderId: "sid-3",
          },
        });
        currentSocket.__fire("cursor:update", {
          senderId: "sid-3",
          cursor: { x: 10, y: 20 },
          color: "#abc",
          username: "Peer Three",
        });
      });

      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalled();
      mockExcalidrawAPI.updateScene.mockClear();

      act(() => {
        currentSocket.__fire("user:leave", {
          userId: "peer-3",
          senderId: "sid-3",
        });
      });

      expect(result.current.collaborators).toEqual([]);
      const lastCall =
        mockExcalidrawAPI.updateScene.mock.calls[
          mockExcalidrawAPI.updateScene.mock.calls.length - 1
        ][0];
      expect((lastCall.collaborators as Map<string, unknown>).has("sid-3")).toBe(
        false,
      );
    });
  });

  describe("remote updates", () => {
    it("merges remote elements and calls updateScene when the delta advances version", async () => {
      const onBeforeRemoteUpdate = vi.fn();
      const onRemoteUpdate = vi.fn();

      renderHook(() =>
        useWhiteboardCollaborationViaRelay({
          whiteboardId,
          excalidrawAPI: mockExcalidrawAPI as never,
          onBeforeRemoteUpdate,
          onRemoteUpdate,
        }),
      );
      await waitFor(() => expect(currentSocket.on).toHaveBeenCalled());
      act(() => {
        currentSocket.connected = true;
        currentSocket.__fire("connect");
      });

      mockExcalidrawAPI.getSceneElements.mockReturnValue([
        { id: "a", version: 1 },
      ] as never);
      mockExcalidrawAPI.getSceneElementsIncludingDeleted.mockReturnValue([
        { id: "a", version: 1 },
      ] as never);

      act(() => {
        currentSocket.__fire("elements:update", {
          senderId: "sid-peer",
          elements: [{ id: "a", version: 2, isDeleted: false }],
          appState: { viewBackgroundColor: "#fff" },
        });
      });

      expect(onBeforeRemoteUpdate).toHaveBeenCalled();
      expect(mockExcalidrawAPI.updateScene).toHaveBeenCalled();
      expect(onRemoteUpdate).toHaveBeenCalled();
    });

    it("skips updateScene when the remote delta has no newer versions", async () => {
      await mountAndConnect();

      mockExcalidrawAPI.getSceneElements.mockReturnValue([
        { id: "a", version: 5 },
      ] as never);
      mockExcalidrawAPI.getSceneElementsIncludingDeleted.mockReturnValue([
        { id: "a", version: 5 },
      ] as never);

      act(() => {
        currentSocket.__fire("elements:update", {
          senderId: "sid-peer",
          elements: [{ id: "a", version: 3, isDeleted: false }],
          appState: {},
        });
      });

      expect(mockExcalidrawAPI.updateScene).not.toHaveBeenCalled();
    });

    it("ignores echo of our own senderId", async () => {
      await mountAndConnect();

      act(() => {
        currentSocket.__fire("elements:update", {
          senderId: currentSocket.id,
          elements: [{ id: "a", version: 99 }],
          appState: {},
        });
      });

      expect(mockExcalidrawAPI.updateScene).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("emits elements:update on the socket with only changed elements", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        result.current.broadcastElements(
          [{ id: "a", version: 1 }] as never,
          { viewBackgroundColor: "#fff", gridSize: null } as never,
        );
      });

      expect(currentSocket.emit).toHaveBeenCalledWith(
        "elements:update",
        expect.objectContaining({
          elements: [expect.objectContaining({ id: "a", version: 1 })],
        }),
      );
    });

    it("does not re-emit elements whose version is unchanged", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        result.current.broadcastElements(
          [{ id: "a", version: 1 }] as never,
          { viewBackgroundColor: "#fff", gridSize: null } as never,
        );
      });
      currentSocket.emit.mockClear();

      act(() => {
        result.current.broadcastElements(
          [{ id: "a", version: 1 }] as never,
          { viewBackgroundColor: "#fff", gridSize: null } as never,
        );
      });

      expect(currentSocket.emit).not.toHaveBeenCalled();
    });

    it("emits cursor:update on the socket", async () => {
      const { result } = await mountAndConnect();

      act(() => {
        result.current.broadcastCursor(42, 99);
      });

      expect(currentSocket.emit).toHaveBeenCalledWith(
        "cursor:update",
        expect.objectContaining({ cursor: { x: 42, y: 99 } }),
      );
    });
  });
});
