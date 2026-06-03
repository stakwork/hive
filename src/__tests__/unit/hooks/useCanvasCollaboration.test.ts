import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useCanvasCollaboration } from "@/hooks/useCanvasCollaboration";
import type { MutableRefObject } from "react";
import { usePusherChannel } from "@/hooks/usePusherChannel";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
  unbind_all: vi.fn(),
};

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn(() => mockChannel),
}));

vi.mock("@/lib/pusher", () => ({
  PUSHER_EVENTS: {
    CANVAS_USER_JOIN: "canvas-user-join",
    CANVAS_USER_LEAVE: "canvas-user-leave",
    CANVAS_CURSOR_UPDATE: "canvas-cursor-update",
    CANVAS_SELECTION_UPDATE: "canvas-selection-update",
  },
}));

// Mock the presence-channel helper the hook actually imports from
vi.mock("@/lib/canvas/presence-channel", () => ({
  getCanvasPresenceChannelName: (githubLogin: string, canvasRef: string) => {
    const safeRef = (canvasRef || "root").replace(/[^a-zA-Z0-9_\-=@]/g, "-");
    return `canvas-presence-${githubLogin}-${safeRef}`;
  },
}));

global.fetch = vi.fn();
const mockSendBeacon = vi.fn(() => true);
Object.defineProperty(navigator, "sendBeacon", {
  value: mockSendBeacon,
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the callback registered for a given Pusher event name. */
function getEventCallback(eventName: string): ((data: unknown) => void) | undefined {
  const call = mockChannel.bind.mock.calls.find((c) => c[0] === eventName);
  return call?.[1];
}

function makeRefs() {
  const viewportRef: MutableRefObject<{ x: number; y: number; zoom: number }> = {
    current: { x: 0, y: 0, zoom: 1 },
  };
  const containerRef: MutableRefObject<HTMLDivElement | null> = { current: null };
  return { viewportRef, containerRef };
}

const BASE_OPTS = {
  githubLogin: "acme-org",
  canvasRef: "",
  userId: "user-abc",
  userName: "Alice",
  enabled: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCanvasCollaboration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  describe("lifecycle", () => {
    it("POSTs a join event on mount", () => {
      const { viewportRef, containerRef } = makeRefs();
      renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/orgs/acme-org/canvas/collaboration",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"type":"join"'),
        }),
      );

      const call = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.type).toBe("join");
      expect(body.canvasRef).toBe("");
      expect(body.user.id).toBe("user-abc");
      expect(body.user.name).toBe("Alice");
    });

    it("POSTs a leave event on unmount", () => {
      const { viewportRef, containerRef } = makeRefs();
      const { unmount } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      unmount();

      const leaveCalls = vi.mocked(global.fetch).mock.calls.filter((c) => {
        try {
          return JSON.parse(c[1]?.body as string)?.type === "leave";
        } catch {
          return false;
        }
      });
      expect(leaveCalls.length).toBeGreaterThan(0);
    });

    it("re-subscribes when canvasRef changes", async () => {
      const { usePusherChannel } = await import("@/hooks/usePusherChannel");
      const { viewportRef, containerRef } = makeRefs();

      const { rerender } = renderHook(
        ({ canvasRef }: { canvasRef: string }) =>
          useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef, canvasRef }),
        { initialProps: { canvasRef: "" } },
      );

      rerender({ canvasRef: "initiative:xyz" });

      // Channel name should change — usePusherChannel called with new name
      expect(usePusherChannel).toHaveBeenCalledWith(
        "canvas-presence-acme-org-initiative-xyz",
      );
    });

    it("binds all four Pusher event handlers", () => {
      const { viewportRef, containerRef } = makeRefs();
      renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      expect(mockChannel.bind).toHaveBeenCalledWith("canvas-user-join", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith("canvas-user-leave", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith("canvas-cursor-update", expect.any(Function));
      expect(mockChannel.bind).toHaveBeenCalledWith("canvas-selection-update", expect.any(Function));
    });
  });

  // -------------------------------------------------------------------------
  // Event handling
  // -------------------------------------------------------------------------
  describe("event handling", () => {
    it("CANVAS_USER_JOIN adds a collaborator", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });

      expect(result.current.collaborators).toHaveLength(1);
      expect(result.current.collaborators[0].id).toBe("user-bob");
      expect(result.current.collaborators[0].name).toBe("Bob");
    });

    it("CANVAS_USER_LEAVE removes the collaborator", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      const onLeave = getEventCallback("canvas-user-leave");

      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });
      expect(result.current.collaborators).toHaveLength(1);

      act(() => {
        onLeave?.({ userId: "user-bob" });
      });
      expect(result.current.collaborators).toHaveLength(0);
    });

    it("CANVAS_CURSOR_UPDATE updates cursor position", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      // Add a collaborator first
      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });

      const onCursor = getEventCallback("canvas-cursor-update");
      act(() => {
        onCursor?.({ senderId: "user-bob", cursor: { x: 100, y: 200 }, color: "#00ff00" });
      });

      const collab = result.current.collaborators.find((c) => c.id === "user-bob");
      expect(collab?.cursor).toEqual({ x: 100, y: 200 });
    });

    it("CANVAS_SELECTION_UPDATE updates selectedNodeId", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });

      const onSelection = getEventCallback("canvas-selection-update");
      act(() => {
        onSelection?.({ senderId: "user-bob", selectedNodeId: "node-xyz" });
      });

      const collab = result.current.collaborators.find((c) => c.id === "user-bob");
      expect(collab?.selectedNodeId).toBe("node-xyz");
    });

    it("ignores join events from own userId", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        // user-abc is the current user (BASE_OPTS.userId)
        onJoin?.({ user: { id: "user-abc", name: "Alice", color: "#ff0000" } });
      });

      expect(result.current.collaborators).toHaveLength(0);
    });

    it("ignores cursor events from own userId", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onCursor = getEventCallback("canvas-cursor-update");
      act(() => {
        onCursor?.({ senderId: "user-abc", cursor: { x: 100, y: 200 }, color: "#ff0000" });
      });

      expect(result.current.collaborators).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Self-filtering
  // -------------------------------------------------------------------------
  describe("self-filtering", () => {
    it("never includes own userId in returned collaborators", async () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-abc", name: "Alice", color: "#ff0000" } });
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });

      expect(result.current.collaborators.map((c) => c.id)).not.toContain("user-abc");
      expect(result.current.collaborators.map((c) => c.id)).toContain("user-bob");
    });
  });

  // -------------------------------------------------------------------------
  // TTL pruning
  // -------------------------------------------------------------------------
  describe("client-side TTL pruning", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("prunes collaborators with lastSeenAt > 60s on the next interval tick", () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });
      expect(result.current.collaborators).toHaveLength(1);

      // Advance past TTL (60s) + one prune interval (15s)
      act(() => {
        vi.advanceTimersByTime(61_000 + 15_000);
      });

      expect(result.current.collaborators).toHaveLength(0);
    });

    it("does not prune fresh collaborators", () => {
      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      const onJoin = getEventCallback("canvas-user-join");
      act(() => {
        onJoin?.({ user: { id: "user-bob", name: "Bob", color: "#00ff00" } });
      });

      // Not quite TTL yet
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(result.current.collaborators).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET presence seed on mount
  // -------------------------------------------------------------------------
  describe("GET presence seed on mount", () => {
    it("fires a GET fetch after join POST to seed pre-existing collaborators", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response) // join POST
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            collaborators: [
              { userId: "user-charlie", name: "Charlie", color: "#0000ff", image: null },
            ],
          }),
        } as Response); // GET seed

      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      // Allow promises to flush
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const getCalls = vi.mocked(global.fetch).mock.calls.filter((c) =>
        typeof c[0] === "string" && c[0].includes("canvasRef="),
      );
      expect(getCalls.length).toBeGreaterThan(0);
      expect(getCalls[0][0]).toContain("/api/orgs/acme-org/canvas/collaboration?canvasRef=");

      expect(result.current.collaborators.find((c) => c.id === "user-charlie")).toBeTruthy();
    });

    it("seeds image from GET response into collaborator entry", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            collaborators: [
              {
                userId: "user-dave",
                name: "Dave",
                color: "#ff00ff",
                image: "https://example.com/dave.jpg",
              },
            ],
          }),
        } as Response);

      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const dave = result.current.collaborators.find((c) => c.id === "user-dave");
      expect(dave?.image).toBe("https://example.com/dave.jpg");
    });

    it("excludes self from GET seed results", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            collaborators: [
              { userId: "user-abc", name: "Alice", color: "#ff0000", image: null }, // self
              { userId: "user-eve", name: "Eve", color: "#00ff00", image: null },
            ],
          }),
        } as Response);

      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.collaborators.find((c) => c.id === "user-abc")).toBeFalsy();
      expect(result.current.collaborators.find((c) => c.id === "user-eve")).toBeTruthy();
    });

    it("does not throw or affect state when GET fails", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockRejectedValueOnce(new Error("Network error")); // GET fails

      const { viewportRef, containerRef } = makeRefs();
      const { result } = renderHook(() =>
        useCanvasCollaboration({ ...BASE_OPTS, viewportRef, containerRef }),
      );

      // Should not throw
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.collaborators).toHaveLength(0);
    });

    it("includes userImage in the join POST payload", () => {
      const { viewportRef, containerRef } = makeRefs();
      renderHook(() =>
        useCanvasCollaboration({
          ...BASE_OPTS,
          userImage: "https://example.com/alice.jpg",
          viewportRef,
          containerRef,
        }),
      );

      const joinCall = vi.mocked(global.fetch).mock.calls.find((c) => {
        try {
          return JSON.parse(c[1]?.body as string)?.type === "join";
        } catch {
          return false;
        }
      });
      expect(joinCall).toBeDefined();
      const body = JSON.parse(joinCall![1]?.body as string);
      expect(body.user.image).toBe("https://example.com/alice.jpg");
    });
  });

  // -------------------------------------------------------------------------
  // Disabled mode
  // -------------------------------------------------------------------------
  describe("disabled mode", () => {
    it("does not POST join or subscribe when enabled=false", () => {
      const { viewportRef, containerRef } = makeRefs();

      renderHook(() =>
        useCanvasCollaboration({
          ...BASE_OPTS,
          viewportRef,
          containerRef,
          enabled: false,
        }),
      );

      // When disabled, usePusherChannel should receive null (no subscription)
      expect(usePusherChannel).toHaveBeenCalledWith(null);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
