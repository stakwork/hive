import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { usePlanPresence } from "@/hooks/usePlanPresence";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";

const mockChannel = {
  bind: vi.fn(),
  unbind_all: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
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
  getFeatureChannelName: vi.fn((featureId: string) => `feature-${featureId}`),
  PUSHER_EVENTS: {
    PLAN_USER_JOIN: "plan-user-join",
    PLAN_USER_LEAVE: "plan-user-leave",
  },
}));

global.fetch = vi.fn();
const mockSendBeacon = vi.fn(() => true);
Object.defineProperty(navigator, "sendBeacon", {
  value: mockSendBeacon,
  writable: true,
});

function getEventCallback(eventName: string): (data: unknown) => void {
  const call = mockChannel.bind.mock.calls.find(
    (c) => c[0] === eventName
  );
  return call?.[1];
}

describe("usePlanPresence", () => {
  const featureId = "feature-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  describe("lifecycle", () => {
    it("should subscribe to feature channel and POST join on mount", async () => {
      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("feature-feature-123");
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "plan-user-join",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "plan-user-leave",
        expect.any(Function)
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/features/feature-123/presence",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: expect.stringContaining("join"),
          })
        );
      });

      const joinCall = vi.mocked(global.fetch).mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/presence"
      );
      const joinBody = JSON.parse(joinCall?.[1]?.body as string);

      expect(joinBody.type).toBe("join");
      expect(joinBody.user.odinguserId).toBe("user-123");
      expect(joinBody.user.name).toBe("Test User");
      expect(joinBody.user.image).toBe("https://example.com/avatar.jpg");
      expect(joinBody.user.color).toBeTruthy();

      unmount();
    });

    it("should use sendBeacon for leave and unsubscribe on unmount", async () => {
      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(mockPusherClient.subscribe).toHaveBeenCalled();
      });

      unmount();

      expect(mockSendBeacon).toHaveBeenCalledWith(
        "/api/features/feature-123/presence",
        new Blob([JSON.stringify({ type: "leave" })], { type: "application/json" })
      );

      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("feature-feature-123");
    });

    it("should register beforeunload listener for browser close", async () => {
      const addListenerSpy = vi.spyOn(window, "addEventListener");
      const removeListenerSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(addListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      });

      unmount();

      expect(removeListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

      addListenerSpy.mockRestore();
      removeListenerSpy.mockRestore();
    });
  });

  describe("collaborator state management", () => {
    it("should add collaborator on PLAN_USER_JOIN event", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      expect(result.current.collaborators).toEqual([]);

      const joinCallback = getEventCallback("plan-user-join");

      const newCollaborator: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: "https://example.com/other.jpg",
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback?.({ user: newCollaborator });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
        expect(result.current.collaborators[0]).toEqual(newCollaborator);
      });
    });

    it("should re-broadcast own join when another user joins", async () => {
      renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      vi.mocked(global.fetch).mockClear();

      const joinCallback = getEventCallback("plan-user-join");

      const newCollaborator: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback?.({ user: newCollaborator });
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/features/feature-123/presence",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"type":"join"'),
          })
        );
      });

      const rebroadcastCall = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(rebroadcastCall[1]?.body as string);
      expect(body.user.odinguserId).toBe("user-123");
    });

    it("should not re-broadcast for own join events", async () => {
      renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      vi.mocked(global.fetch).mockClear();

      const joinCallback = getEventCallback("plan-user-join");

      act(() => {
        joinCallback({
          user: { odinguserId: "user-123", name: "Test User", image: null, color: "#FF6B6B", joinedAt: Date.now() },
        });
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should remove collaborator on PLAN_USER_LEAVE event", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = getEventCallback("plan-user-join");

      const collaborator: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback?.({ user: collaborator });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
      });

      const leaveCallback = getEventCallback("plan-user-leave");

      act(() => {
        leaveCallback?.({ userId: "user-456" });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(0);
      });
    });

    it("should deduplicate collaborators by odinguserId", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = getEventCallback("plan-user-join");

      const collaborator: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback({ user: collaborator });
        joinCallback({ user: { ...collaborator, name: "Updated Name" } });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
      });

      expect(result.current.collaborators[0].name).toBe("Other User");
    });

    it("should filter out current user from collaborators", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = getEventCallback("plan-user-join");

      const otherUser: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#4ECDC4",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback?.({ user: otherUser });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
        expect(result.current.collaborators[0].odinguserId).toBe("user-456");
      });
    });

    it("should handle multiple collaborators", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = getEventCallback("plan-user-join");

      const users: CollaboratorInfo[] = [
        {
          odinguserId: "user-1",
          name: "User 1",
          image: null,
          color: "#FF6B6B",
          joinedAt: Date.now(),
        },
        {
          odinguserId: "user-2",
          name: "User 2",
          image: null,
          color: "#4ECDC4",
          joinedAt: Date.now(),
        },
        {
          odinguserId: "user-3",
          name: "User 3",
          image: null,
          color: "#45B7D1",
          joinedAt: Date.now(),
        },
      ];

      act(() => {
        users.forEach((user) => {
          joinCallback?.({ user });
        });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(3);
      });

      expect(result.current.collaborators.map((c) => c.odinguserId)).toEqual([
        "user-1",
        "user-2",
        "user-3",
      ]);
    });
  });

  describe("error handling", () => {
    it("should handle fetch errors gracefully on join", async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(result.current.collaborators).toEqual([]);
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should not subscribe if no session", async () => {
      const { useSession } = await import("next-auth/react");
      vi.mocked(useSession).mockReturnValueOnce({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { result } = renderHook(() => usePlanPresence({ featureId }));

      expect(result.current.collaborators).toEqual([]);
    });

    it("should handle rapid join/leave of same user", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = getEventCallback("plan-user-join");
      const leaveCallback = getEventCallback("plan-user-leave");

      const user: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Rapid User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      // Join
      act(() => {
        joinCallback?.({ user });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
      });

      // Leave
      act(() => {
        leaveCallback?.({ userId: "user-456" });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(0);
      });

      // Join again
      act(() => {
        joinCallback?.({ user });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
      });
    });
  });
});
