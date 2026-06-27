import { mockData } from "@/__tests__/support/fixtures/mock-data";
import {
  resolveUserWorkspaceRedirect,
  WORKSPACE_FREE_ROUTES,
} from "@/lib/auth/workspace-resolver";
import {
  getDefaultWorkspaceForUser,
  getUserWorkspaces,
  getWorkspaceOrgGithubLogin,
} from "@/services/workspace";
import { Session } from "next-auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/services/workspace", () => ({
  getDefaultWorkspaceForUser: vi.fn(),
  getUserWorkspaces: vi.fn(),
  getWorkspaceOrgGithubLogin: vi.fn(),
}));

const mockedGetUserWorkspaces = vi.mocked(getUserWorkspaces);
const mockedGetDefaultWorkspaceForUser = vi.mocked(getDefaultWorkspaceForUser);
const mockedGetWorkspaceOrgGithubLogin = vi.mocked(getWorkspaceOrgGithubLogin);

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

    test("should redirect to org canvas when user has one workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        id: "ws-1",
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("my-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/my-org",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should fallback to /w/<slug> when user has one workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        id: "ws-1",
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/test-workspace",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should redirect to org canvas for default workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);
      const defaultWorkspace = mockData.workspaceResponse({
        id: "ws2",
        slug: "workspace-2",
        ownerId: "user2",
      });

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(defaultWorkspace);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("stakwork");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/stakwork",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-2",
      });
      expect(mockedGetDefaultWorkspaceForUser).toHaveBeenCalledWith("user1");
    });

    test("should fallback to /w/<slug> for default workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);
      const defaultWorkspace = mockData.workspaceResponse({
        id: "ws2",
        slug: "workspace-2",
        ownerId: "user2",
      });

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(defaultWorkspace);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-2",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-2",
      });
    });

    test("should fallback to first workspace org canvas when no default and POD_URL set", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(null);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("fallback-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/fallback-org",
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

    test("should redirect to org canvas when user has exactly one workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        id: "ws-1",
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("test-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/test-org",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should fallback to /w/<slug> when user has exactly one workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        id: "ws-1",
        slug: "test-workspace",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/test-workspace",
        workspaceCount: 1,
        defaultWorkspaceSlug: "test-workspace",
      });
    });

    test("should redirect to org canvas for default workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);
      const defaultWorkspace = mockData.workspaceResponse({
        id: "ws2",
        slug: "workspace-2",
        ownerId: "user2",
      });

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(defaultWorkspace);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("hive-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/hive-org",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-2",
      });
      expect(mockedGetDefaultWorkspaceForUser).toHaveBeenCalledWith("user1");
    });

    test("should fallback to /w/<slug> for default workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);
      const defaultWorkspace = mockData.workspaceResponse({
        id: "ws2",
        slug: "workspace-2",
        ownerId: "user2",
      });

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(defaultWorkspace);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/workspace-2",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-2",
      });
    });

    test("should redirect to org canvas for fallback first workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(null);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("first-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/first-org",
        workspaceCount: 2,
        defaultWorkspaceSlug: "workspace-1",
      });
    });

    test("should fallback to /w/<slug> for first workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(null);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

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

    test("should redirect to onboarding on getDefaultWorkspaceForUser error", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });

      const mockWorkspaces = mockData.workspaces(2, [
        { slug: "workspace-1", ownerId: "user1", userRole: "OWNER" },
        { slug: "workspace-2", ownerId: "user2", userRole: "DEVELOPER" },
      ]);

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockRejectedValue(new Error("Default workspace query failed"));

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
  });

  describe("WORKSPACE_FREE_ROUTES — requestedPath exemptions", () => {
    test("WORKSPACE_FREE_ROUTES contains /settings", () => {
      expect(WORKSPACE_FREE_ROUTES).toContain('/settings');
    });

    test("should NOT redirect when requestedPath is /settings and user has no workspaces", async () => {
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session, '/settings');

      expect(result).toEqual({ shouldRedirect: false, workspaceCount: 0 });
    });

    test("should NOT redirect when requestedPath starts with /settings (sub-path) and user has no workspaces", async () => {
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session, '/settings/profile');

      expect(result).toEqual({ shouldRedirect: false, workspaceCount: 0 });
    });

    test("should NOT redirect when requestedPath is /settings and POD_URL is set", async () => {
      process.env.POD_URL = "https://pod.example.com";
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session, '/settings');

      expect(result).toEqual({ shouldRedirect: false, workspaceCount: 0 });
    });

    test("should still redirect to onboarding when requestedPath is undefined and user has no workspaces", async () => {
      const session = mockData.session("user1");
      mockedGetUserWorkspaces.mockResolvedValue([]);

      const result = await resolveUserWorkspaceRedirect(session, undefined);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
    });

    test("should still apply org redirect when requestedPath is /settings but user has a workspace with org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({ id: "ws-1", slug: "my-workspace", ownerId: "user1" });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("settings-org");

      const result = await resolveUserWorkspaceRedirect(session, '/settings');

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/settings-org",
        workspaceCount: 1,
        defaultWorkspaceSlug: "my-workspace",
      });
    });

    test("should still apply /w/<slug> redirect when requestedPath is /settings but user has workspace without org", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({ id: "ws-1", slug: "my-workspace", ownerId: "user1" });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

      const result = await resolveUserWorkspaceRedirect(session, '/settings');

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/w/my-workspace",
        workspaceCount: 1,
        defaultWorkspaceSlug: "my-workspace",
      });
    });

    test("should NOT redirect on error when requestedPath is /settings", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockRejectedValue(new Error("DB error"));

      const result = await resolveUserWorkspaceRedirect(session, '/settings');

      expect(result).toEqual({ shouldRedirect: false, workspaceCount: 0 });
      consoleErrorSpy.mockRestore();
    });

    test("should redirect to onboarding on error when requestedPath is not a free route", async () => {
      const session = mockData.session("user1");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedGetUserWorkspaces.mockRejectedValue(new Error("DB error"));

      const result = await resolveUserWorkspaceRedirect(session, '/some-other-page');

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/onboarding/workspace",
        workspaceCount: 0,
      });
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

    test("should handle large workspace arrays without performance issues", async () => {
      const session = mockData.session("user1");
      const mockWorkspaces = mockData.workspaces(100);
      const defaultWorkspace = mockData.workspaceResponse({ id: "ws-50", slug: "workspace-50" });

      mockedGetUserWorkspaces.mockResolvedValue(mockWorkspaces);
      mockedGetDefaultWorkspaceForUser.mockResolvedValue(defaultWorkspace);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue("large-org");

      const result = await resolveUserWorkspaceRedirect(session);

      expect(result).toEqual({
        shouldRedirect: true,
        redirectUrl: "/org/large-org",
        workspaceCount: 100,
        defaultWorkspaceSlug: "workspace-50",
      });
    });

    test("should handle workspace with special characters in slug (no org)", async () => {
      const session = mockData.session("user1");
      const mockWorkspace = mockData.workspaceResponse({
        id: "ws-1",
        slug: "test-workspace-123",
        ownerId: "user1",
      });
      mockedGetUserWorkspaces.mockResolvedValue([mockWorkspace]);
      mockedGetWorkspaceOrgGithubLogin.mockResolvedValue(null);

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


