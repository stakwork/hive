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
import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
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

// Import the mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

describe("GitHub App Status API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/app/status", () => {
    describe("Unauthenticated access", () => {
      test("should return hasTokens: false and hasRepoAccess: false for unauthenticated users", async () => {
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

        // Verify no downstream calls were made
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
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Global token check mode (no workspaceSlug)", () => {
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
        expect(data.hasRepoAccess).toBe(false); // No repo URL provided

        // Verify getUserAppTokens was called without githubOwner (global check)
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });

      test("should return hasTokens: false when user has no GitHub tokens", async () => {
        const testUser = await createTestUser();

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

        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });
    });

    describe("Workspace mode with linked SourceControlOrg", () => {
      test("should return hasTokens: true when workspace has linked sourceControlOrg and user has tokens", async () => {
        const { testUser, accessToken, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
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
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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

        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
      });

      test("should return hasTokens: false when workspace has linked sourceControlOrg but user has no tokens", async () => {
        const testUser = await createTestUser();

        // Create a sourceControlOrg without user tokens
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            githubLogin: "other-owner",
            githubInstallationId: 999999,
            name: "Other Org",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: "no-tokens-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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

      test("should check repository access when workspace has tokens and repositoryUrl provided", async () => {
        const { testUser, accessToken, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "repo-access-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "123456",
          testRepositoryUrls.https
        );
      });

      test("should return hasRepoAccess: false when repository access check fails", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-repo-access-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/private-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Workspace mode with auto-linking", () => {
      test("should auto-link workspace to existing SourceControlOrg by githubLogin", async () => {
        const { testUser, accessToken, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "auto-link-owner",
            githubInstallationId: 777777,
          });

        // Create workspace without sourceControlOrg linked
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "auto-link-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/auto-link-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        // Verify workspace was auto-linked to sourceControlOrg
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
          include: { sourceControlOrg: true },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
        expect(updatedWorkspace?.sourceControlOrg?.githubLogin).toBe(
          "auto-link-owner"
        );

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "777777",
          "https://github.com/auto-link-owner/test-repo"
        );
      });

      test("should return hasTokens: false when workspace not linked and no matching SourceControlOrg exists", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-org-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/nonexistent-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);

        // Verify workspace was NOT linked (no matching org)
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
      });

      test("should skip repository access check when installationId is missing", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "no-installation-owner",
            githubInstallationId: null as any, // No installation ID
          });

        // Force null installationId
        await db.sourceControlOrg.update({
          where: { id: sourceControlOrg.id },
          data: { githubInstallationId: null },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-installation-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/no-installation-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No installation ID, cannot check access

        // Verify checkRepositoryAccess was NOT called
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });
    });

    describe("Workspace access validation", () => {
      test("should return 403 when user lacks workspace access", async () => {
        const testUser = await createTestUser();
        const otherUser = await createTestUser({ name: "Other User" });

        const workspace = await createTestWorkspace({
          ownerId: otherUser.id,
          slug: "forbidden-workspace",
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

        // Verify no downstream calls were made after authorization failure
        expect(getUserAppTokens).not.toHaveBeenCalled();
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });

      test("should return 403 for non-existent workspace", async () => {
        const testUser = await createTestUser();

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
            workspaceSlug: "nonexistent-workspace",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe("Workspace not found or access denied");
      });
    });

    describe("Error handling and fail-safe behavior", () => {
      test("should return 200 with false values when getUserAppTokens throws error", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should return 200 with false values when checkRepositoryAccess throws error", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "error-owner",
            githubInstallationId: 888888,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "error-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle workspace validation error gracefully", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockRejectedValue(
          new Error("Validation error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: "error-workspace",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Repository URL parsing", () => {
      test("should support HTTPS repository URL format", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 123456,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "https-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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
      });

      test("should support SSH repository URL format", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "nodejs",
            githubInstallationId: 123456,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "ssh-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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
            githubInstallationId: 123456,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "git-suffix-workspace",
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
          canAdmin: false,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          },
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
  });
});