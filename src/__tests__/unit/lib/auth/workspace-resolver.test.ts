import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import {
  validateUserWorkspaceAccess,
  resolveUserWorkspaceRedirect,
  handleWorkspaceRedirect,
} from "@/lib/auth/workspace-resolver";
import {
  getUserWorkspaces,
  getDefaultWorkspaceForUser,
} from "@/services/workspace";
import { Session } from "next-auth";
import { redirect } from "next/navigation";

// Mock the workspace service
vi.mock("@/services/workspace", () => ({
  getUserWorkspaces: vi.fn(),
  getDefaultWorkspaceForUser: vi.fn(),
}));

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const mockedGetUserWorkspaces = vi.mocked(getUserWorkspaces);
const mockedGetDefaultWorkspaceForUser = vi.mocked(getDefaultWorkspaceForUser);
const mockedRedirect = vi.mocked(redirect);

describe("Workspace Resolver - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    // Reset environment variables
    delete process.env.POD_URL;
  });

  describe("validateUserWorkspaceAccess", () => {
    const mockSession: Session = {
      user: {
        id: "user1",
        email: "user@example.com",
        name: "Test User",
      },
      expires: "2024-12-31",
    };

    // Mock workspaces matching the actual getUserWorkspaces return type
    const mockWorkspaces = [
      {
        id: "ws1",
        name: "Workspace 1",
        slug: "workspace-1",
        ownerId: "user1",
        userRole: "OWNER" as const,
        memberCount: 3,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "ws2",
        name: "Workspace 2",
        slug: "workspace-2",
        ownerId: "user2",
        userRole: "DEVELOPER" as const,
        memberCount: 5,
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
      {
        id: "ws3",
        name: "Workspace 3",
        slug: "workspace-3",
        ownerId: "user3",
        userRole: "VIEWER" as const,
        memberCount: 10,
        createdAt: "2024-01-03T00:00:00.000Z",
        updatedAt: "2024-01-03T00:00:00.000Z",
      },
    ];

    test("should return workspace slug when user has access", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await validateUserWorkspaceAccess(mockSession, "workspace-2");

      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
      expect(result).toBe("workspace-2");
    });

    test("should return null when user doesn't have access to workspace", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await validateUserWorkspaceAccess(mockSession, "workspace-4");

      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
      expect(result).toBeNull();
    });

    test("should return null when session is null", async () => {
      const result = await validateUserWorkspaceAccess(null, "workspace-1");

      expect(mockedGetUserWorkspaces).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test("should return null when session has no user", async () => {
      const invalidSession: Session = {
        expires: "2024-12-31",
      } as Session;

      const result = await validateUserWorkspaceAccess(invalidSession, "workspace-1");

      expect(mockedGetUserWorkspaces).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test("should handle case-sensitive workspace slugs correctly", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await validateUserWorkspaceAccess(mockSession, "Workspace-1");

      expect(result).toBeNull(); // Should not match due to case sensitivity
    });

    test("should handle empty workspace list", async () => {
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await validateUserWorkspaceAccess(mockSession, "workspace-1");

      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
      expect(result).toBeNull();
    });

    test("should handle workspace service errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockRejectedValue(new Error("Database connection failed"));

      const result = await validateUserWorkspaceAccess(mockSession, "workspace-1");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error validating workspace access:",
        expect.any(Error)
      );
      expect(result).toBeNull();

      consoleErrorSpy.mockRestore();
    });

    test("should handle workspace slugs with hyphens and numbers", async () => {
      const workspaceWithComplexSlug = {
        ...mockWorkspaces[0],
        slug: "my-workspace-123-test",
      };
      mockedGetUserWorkspaces.mockResolvedValue([workspaceWithComplexSlug]);

      const result = await validateUserWorkspaceAccess(mockSession, "my-workspace-123-test");

      expect(result).toBe("my-workspace-123-test");
    });

    test("should return null for empty workspace slug", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await validateUserWorkspaceAccess(mockSession, "");

      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
      expect(result).toBeNull();
    });

    test("should handle session with user id as non-string type", async () => {
      const sessionWithNumberId: Session = {
        user: {
          id: 12345 as any, // Simulating incorrect type
          email: "user@example.com",
          name: "Test User",
        },
        expires: "2024-12-31",
      };

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await validateUserWorkspaceAccess(sessionWithNumberId, "workspace-1");

      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith(12345);
      expect(result).toBe("workspace-1");
    });

    test("should validate access when user has access to multiple workspaces", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      // Test access to first workspace
      let result = await validateUserWorkspaceAccess(mockSession, "workspace-1");
      expect(result).toBe("workspace-1");

      // Test access to second workspace  
      result = await validateUserWorkspaceAccess(mockSession, "workspace-2");
      expect(result).toBe("workspace-2");

      // Test no access to non-existent workspace
      result = await validateUserWorkspaceAccess(mockSession, "workspace-999");
      expect(result).toBeNull();
    });

    test("should handle getUserWorkspaces returning undefined", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockResolvedValue(undefined as any);

      const result = await validateUserWorkspaceAccess(mockSession, "workspace-1");

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(result).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("resolveUserWorkspaceRedirect", () => {
    const mockSession: Session = {
      user: {
        id: "user1",
        email: "user@example.com",
        name: "Test User",
      },
      expires: "2024-12-31",
    };

    const mockWorkspaces = [
      {
        id: "ws1",
        name: "Workspace 1",
        slug: "workspace-1",
        ownerId: "user1",
        userRole: "OWNER" as const,
        memberCount: 3,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "ws2",
        name: "Workspace 2",
        slug: "workspace-2",
        ownerId: "user2",
        userRole: "DEVELOPER" as const,
        memberCount: 5,
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
    ];

    test("should redirect to onboarding when user has no workspaces", async () => {
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
    });

    test("should redirect to signin when POD_URL is set and user has no workspaces", async () => {
      process.env.POD_URL = "https://pod.example.com";
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/auth/signin",
        workspaceCount: 0,
      });
    });

    test("should redirect to single workspace when user has exactly one", async () => {
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspaces[0]]);

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-1/tasks",
        workspaceCount: 1,
        defaultWorkspaceSlug: "workspace-1",
      });
    });

    test("should redirect to default workspace when user has multiple", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue({
        id: "ws2",
        name: "Workspace 2",
        slug: "workspace-2",
        ownerId: "user2",
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      });

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(mockedGetDefaultWorkspaceForUser).toHaveBeenCalledWith("user1");
      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-2/tasks",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-2",
      });
    });

    test("should fallback to first workspace when no default is set", async () => {
      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-1/tasks",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-1",
      });
    });

    test("should handle errors and redirect to onboarding", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockRejectedValue(new Error("Database error"));

      const result = await resolveUserWorkspaceRedirect(mockSession);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error resolving workspace redirect:",
        expect.any(Error)
      );
      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });

      consoleErrorSpy.mockRestore();
    });

    test("should handle session with missing user id gracefully", async () => {
      const invalidSession: Session = {
        user: {
          email: "user@example.com",
          name: "Test User",
        },
        expires: "2024-12-31",
      } as Session;

      // This will throw an error when trying to access id
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resolveUserWorkspaceRedirect(invalidSession);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe("handleWorkspaceRedirect", () => {
    const mockSession: Session = {
      user: {
        id: "user1",
        email: "user@example.com",
        name: "Test User",
      },
      expires: "2024-12-31",
    };

    test("should call redirect when shouldRedirect is true", async () => {
      mockedGetUserWorkspaces.mockResolvedValue([
        {
          id: "ws1",
          name: "Workspace 1",
          slug: "workspace-1",
          ownerId: "user1",
          userRole: "OWNER" as const,
          memberCount: 3,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ]);

      await handleWorkspaceRedirect(mockSession);

      expect(mockedRedirect).toHaveBeenCalledWith("/w/workspace-1/tasks");
    });

    test("should not call redirect when shouldRedirect is false", async () => {
      // This scenario shouldn't happen in practice as shouldRedirect is always true
      // in the current implementation, but we test for completeness
      const mockResolve = vi.fn().mockResolvedValue({
        shouldRedirect: false,
        workspaceCount: 0,
      });

      // Temporarily replace the implementation
      const originalModule = await vi.importActual<typeof import("@/lib/auth/workspace-resolver")>(
        "@/lib/auth/workspace-resolver"
      );
      
      vi.doMock("@/lib/auth/workspace-resolver", () => ({
        ...originalModule,
        resolveUserWorkspaceRedirect: mockResolve,
        handleWorkspaceRedirect: async (session: Session) => {
          const result = await mockResolve(session);
          if (result.shouldRedirect && result.redirectUrl) {
            redirect(result.redirectUrl);
          }
        },
      }));

      // Re-import to get mocked version
      const { handleWorkspaceRedirect: mockedHandle } = await import(
        "@/lib/auth/workspace-resolver"
      );

      await mockedHandle(mockSession);

      expect(mockedRedirect).not.toHaveBeenCalled();

      // Restore
      vi.doUnmock("@/lib/auth/workspace-resolver");
    });

    test("should handle redirect errors", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockRejectedValue(new Error("Service unavailable"));

      await handleWorkspaceRedirect(mockSession);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mockedRedirect).toHaveBeenCalledWith("/onboarding/workspace");

      consoleErrorSpy.mockRestore();
    });
  });
});