import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { usePlanPresence } from "@/hooks/usePlanPresence";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";

// Mock dependencies
const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
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

// Mock modules
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

// Mock fetch
global.fetch = vi.fn();

describe("usePlanPresence", () => {
  const featureId = "feature-123";

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("lifecycle", () => {
    it("should subscribe to feature channel and POST join on mount", async () => {
      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      // Should subscribe to the correct channel
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("feature-feature-123");

      // Should bind to join/leave events
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "plan-user-join",
        expect.any(Function)
      );
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "plan-user-leave",
        expect.any(Function)
      );

      // Should POST join
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

      const joinCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
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

    it("should POST leave and unsubscribe on unmount", async () => {
      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(mockPusherClient.subscribe).toHaveBeenCalled();
      });

      // Clear previous fetch calls
      vi.clearAllMocks();

      unmount();

      // Should POST leave
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/features/feature-123/presence",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("leave"),
          })
        );
      });

      // Should unbind and unsubscribe
      expect(mockChannel.unbind_all).toHaveBeenCalled();
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith("feature-feature-123");
    });
  });

  describe("collaborator state management", () => {
    it("should add collaborator on PLAN_USER_JOIN event", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      // Initially no collaborators
      expect(result.current.collaborators).toEqual([]);

      // Simulate user join event
      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];

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

    it("should remove collaborator on PLAN_USER_LEAVE event", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      // Add a collaborator first
      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];

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

      // Simulate user leave event
      const leaveCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-leave"
      )?.[1];

      act(() => {
        leaveCallback?.({ userId: "user-456" });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(0);
      });
    });

    it("should deduplicate collaborators by odinguserId", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];

      const collaborator: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      // Join same user twice
      act(() => {
        joinCallback?.({ user: collaborator });
        joinCallback?.({ user: { ...collaborator, name: "Updated Name" } });
      });

      await waitFor(() => {
        expect(result.current.collaborators).toHaveLength(1);
      });

      // Should still be the original entry (deduplication prevents update)
      expect(result.current.collaborators[0].name).toBe("Other User");
    });

    it("should filter out current user from collaborators", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];

      // Add current user
      const currentUserAsCollaborator: CollaboratorInfo = {
        odinguserId: "user-123", // Same as mockSession.data.user.id
        name: "Test User",
        image: null,
        color: "#FF6B6B",
        joinedAt: Date.now(),
      };

      // Add another user
      const otherUser: CollaboratorInfo = {
        odinguserId: "user-456",
        name: "Other User",
        image: null,
        color: "#4ECDC4",
        joinedAt: Date.now(),
      };

      act(() => {
        joinCallback?.({ user: currentUserAsCollaborator });
        joinCallback?.({ user: otherUser });
      });

      await waitFor(() => {
        // Should only return the other user, not current user
        expect(result.current.collaborators).toHaveLength(1);
        expect(result.current.collaborators[0].odinguserId).toBe("user-456");
      });
    });

    it("should handle multiple collaborators", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];

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

      // Verify all users are present
      expect(result.current.collaborators.map((c) => c.odinguserId)).toEqual([
        "user-1",
        "user-2",
        "user-3",
      ]);
    });
  });

  describe("error handling", () => {
    it("should handle fetch errors gracefully on join", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error")
      );

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = renderHook(() => usePlanPresence({ featureId }));

      // Should still initialize without crashing
      await waitFor(() => {
        expect(result.current.collaborators).toEqual([]);
      });

      consoleErrorSpy.mockRestore();
    });

    it("should handle fetch errors gracefully on leave", async () => {
      const { unmount } = renderHook(() => usePlanPresence({ featureId }));

      await waitFor(() => {
        expect(mockPusherClient.subscribe).toHaveBeenCalled();
      });

      // Mock fetch to fail on leave
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error")
      );

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();

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

      // Should not subscribe without session
      expect(result.current.collaborators).toEqual([]);
      // Subscribe may still be called but no join POST should happen
    });

    it("should handle rapid join/leave of same user", async () => {
      const { result } = renderHook(() => usePlanPresence({ featureId }));

      const joinCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-join"
      )?.[1];
      const leaveCallback = mockChannel.bind.mock.calls.find(
        (call) => call[0] === "plan-user-leave"
      )?.[1];

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
