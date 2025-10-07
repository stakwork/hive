import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { db } from "@/lib/db";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock getUserAppTokens and checkRepositoryAccess from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

// Mock validateWorkspaceAccess from workspace service
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Import mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

describe("GitHub App Status API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/app/status", () => {
    describe("Authentication scenarios", () => {
      test("should return hasTokens: false for unauthenticated users", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        // Should not call any token/workspace validation functions
        expect(getUserAppTokens).not.toHaveBeenCalled();
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
        expect(validateWorkspaceAccess).not.toHaveBeenCalled();
      });

      test("should return hasTokens: false for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });
    });

    describe("Global token check (no workspace)", () => {
      test("should return hasTokens: true when user has GitHub tokens", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        // Verify getUserAppTokens was called with userId only (global mode)
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });

      test("should return hasTokens: false when user has no tokens", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should return hasTokens: false when getUserAppTokens returns empty object", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock returns object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Workspace-specific token check", () => {
      test("should return 403 when user lacks workspace access", async () => {
        const testUser = await createTestUser({ name: "No Access User" });
        const otherUser = await createTestUser({ name: "Other User" });
        const workspace = await createTestWorkspace({
          ownerId: otherUser.id,
          slug: "other-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe("Workspace not found or access denied");

        // Should call validateWorkspaceAccess before any token checks
        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
        expect(getUserAppTokens).not.toHaveBeenCalled();
      });

      test("should return hasTokens: true when workspace has sourceControlOrg with user tokens", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        // Link workspace to sourceControlOrg
        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        // Verify workspace access validation was called
        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
      });

      test("should return hasTokens: false when workspace has sourceControlOrg but user has no tokens", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });
        const { sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "other-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        // Link workspace to sourceControlOrg (but testUser has no tokens for it)
        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle workspace without sourceControlOrg", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Auto-linking workspace to SourceControlOrg", () => {
      test("should auto-link workspace to existing SourceControlOrg when repo URL is provided", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);

        // Verify workspace was linked to sourceControlOrg
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });

      test("should return hasTokens: false when SourceControlOrg doesn't exist for repo URL", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/nonexistent-owner/repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should support SSH repository URL format for auto-linking", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "nodejs",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "git@github.com:nodejs/node.git",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);

        // Verify workspace was linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });
    });

    describe("Repository access validation", () => {
      test("should check repository access when tokens and repo URL are provided", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456789,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        // Link workspace to sourceControlOrg
        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        // Verify checkRepositoryAccess was called with correct parameters
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "123456789",
          testRepositoryUrls.https
        );
      });

      test("should return hasRepoAccess: false when repository access check fails", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456789,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should skip repository access check when installationId is missing", async () => {
        // Use regular fixture (no need for null installationId in DB)
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456789, // Valid ID for DB
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        // Mock database query to return null installationId to simulate missing ID
        const originalFindUnique = db.workspace.findUnique;
        vi.spyOn(db.workspace, 'findUnique').mockResolvedValue({
          ...workspace,
          sourceControlOrg: {
            ...sourceControlOrg,
            githubInstallationId: null, // This simulates missing installation ID
          },
          swarm: null,
        } as any);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        // Verify checkRepositoryAccess was NOT called
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
        
        // Restore original method
        db.workspace.findUnique = originalFindUnique;
      });

      test("should support SSH repository URL format", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "nodejs",
            githubInstallationId: 123456789,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456789,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);
      });
    });

    describe("Error handling", () => {
      test("should return fail-safe response on unexpected errors", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should return fail-safe response when validateWorkspaceAccess throws", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockRejectedValue(
          new Error("Database error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should return fail-safe response when checkRepositoryAccess throws", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456789,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
        });

        await db.workspace.update({
          where: { id: workspace.id },
          data: { sourceControlOrgId: sourceControlOrg.id },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });

        vi.mocked(checkRepositoryAccess).mockRejectedValue(
          new Error("GitHub API error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });
    });

    describe("Response format validation", () => {
      test("should return properly formatted response with hasTokens and hasRepoAccess fields", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("hasTokens");
        expect(data).toHaveProperty("hasRepoAccess");
        expect(typeof data.hasTokens).toBe("boolean");
        expect(typeof data.hasRepoAccess).toBe("boolean");
      });

      test("should only include hasTokens and hasRepoAccess fields in response", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(Object.keys(data).sort()).toEqual(["hasRepoAccess", "hasTokens"]);
      });
    });
  });
});