import { mockData } from "@/__tests__/utils/test-helpers";
import {
  resolveUserWorkspaceRedirect,
} from "@/lib/auth/workspace-resolver";
import { getUserWorkspaces } from "@/services/workspace";
import { Session } from "next-auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/services/workspace", () => ({
  getUserWorkspaces: vi.fn(),
}));

const mockedGetUserWorkspaces = vi.mocked(getUserWorkspaces);

describe("resolveUserWorkspaceRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    delete process.env.POD_URL;
  });


  describe("when POD_URL is set", () => {
    beforeEach(() => {
      process.env.POD_URL = "https://pod.example.com";
    });

    test("should redirect to signin when user has no workspaces", async () => {
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/auth/signin",
        workspaceCount: 0,
      });
      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
    });

    test("should redirect to workspace when user has one workspace", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/test-workspace",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should redirect to first workspace from sorted list (most recently accessed)", async () => {
      const session = mockData.session("user1");
      // getUserWorkspaces returns workspaces sorted by lastAccessedAt desc
      // workspace-1 is most recently accessed
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-1",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-1",
      });
    });
  });

  describe("when POD_URL is not set", () => {
    test("should redirect to onboarding when user has no workspaces", async () => {
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
    });

    test("should redirect to single workspace when user has exactly one", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/test-workspace",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should redirect to first workspace from sorted list (most recently accessed)", async () => {
      const session = mockData.session("user1");
      // getUserWorkspaces returns workspaces sorted by lastAccessedAt desc
      // workspace-1 is most recently accessed
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-1",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-1",
      });
    });
  });

  describe("error handling", () => {
    test("should redirect to onboarding on getUserWorkspaces error", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

      mockedGetUserWorkspaces.mockRejectedValue(new Error("Database connection failed"));

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error resolving workspace redirect:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle network timeout errors gracefully", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

      const timeoutError = new Error("Network timeout");
      timeoutError.name = "TimeoutError";
      mockedGetUserWorkspaces.mockRejectedValue(timeoutError);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error resolving workspace redirect:",
        expect.objectContaining({ name: "TimeoutError" })
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    test("should handle session with minimal user object", async () => {
      const session = mockData.session("user1", {
        name: undefined,
        email: undefined,
      });

      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("user1");
    });

    test("should redirect to first workspace from large sorted array", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(100); // Large array test

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await resolveUserWorkspaceRedirect(session);

      // First workspace from the sorted array
      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: `/w/${mockWorkspaces[0].slug}`,
        workspaceCount: 100,
        defaultWorkspaceSlug: mockWorkspaces[0].slug,
      });
    });

    test("should handle workspace with special characters in slug", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        slug: "test-workspace-123",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/test-workspace-123",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace-123",
      });
    });

    test("should handle null/undefined workspace data gracefully", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

      // Mock service returning malformed data
      mockedGetUserWorkspaces.mockResolvedValue(null as never);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    test("should handle user ID extraction from different session formats", async () => {
      const customSession = {
        user: { id: "custom-user-123" },
        expires: "2024-12-31T00:00:00.000Z",
      } as Session;

      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(customSession);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
      expect(mockedGetUserWorkspaces).toHaveBeenCalledWith("custom-user-123");
    });
  });
});
