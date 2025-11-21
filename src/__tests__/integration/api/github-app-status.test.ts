import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import {
  createAuthenticatedSession,
  createGetRequest,
  expectForbidden,
  expectSuccess,
  getMockedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { GET } from "@/app/api/github/app/status/route";
import { db } from "@/lib/db";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock GitHub App functions
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

// Mock workspace service
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Import the mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub App Status API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("GET /api/github/app/status", () => {
    describe("Authentication scenarios", () => {
      test("should return hasTokens=false and hasRepoAccess=false for unauthenticated user (graceful degradation)", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        // Verify no downstream functions were called
        expect(getUserAppTokens).not.toHaveBeenCalled();
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
        expect(validateWorkspaceAccess).not.toHaveBeenCalled();
      });

      test("should return hasTokens=false for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should process authenticated user with valid session", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });
    });

    describe("Token existence scenarios", () => {
      test("should return hasTokens=false when user has no GitHub tokens", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });

      test("should return hasTokens=true when user has GitHub tokens", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No repo URL provided
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });

      test("should return hasTokens=false when tokens exist but accessToken is missing", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
      });
    });

    describe("Workspace access scenarios", () => {
      test("should return 403 when workspace access is denied", async () => {
        const testUser = await createTestUser();
        const differentUser = await createTestUser();
        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: differentUser.id,
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
        
        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.error).toBe("Workspace not found or access denied");
        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
      });

      test("should check workspace-specific tokens when workspace access is granted", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
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

        expect(data.hasTokens).toBe(true);
        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
      });

      test("should return hasTokens=false when workspace has no sourceControlOrg linked", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          name: "Unlinked Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: null,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: false,
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
      });
    });

    describe("Repository access scenarios", () => {
      test("should return hasRepoAccess=true when user has repository access", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: testRepositoryUrls.https,
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
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.https
        );
      });

      test("should return hasRepoAccess=false when user does not have repository access", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: testRepositoryUrls.https,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: false,
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
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.https
        );
      });

      test("should use repositoryUrl query parameter when provided", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
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

        const customRepoUrl = "https://github.com/custom-owner/custom-repo";

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: customRepoUrl,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasRepoAccess).toBe(true);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          customRepoUrl
        );
      });

      // NOTE: This test is disabled because githubInstallationId is a required field in the schema
      // and cannot be set to null. The scenario would require schema changes to support optional installation IDs.
      test.skip("should skip repository access check when workspace has no installation ID", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        // Update sourceControlOrg to remove installation ID
        await db.sourceControlOrg.update({
          where: { id: sourceControlOrg.id },
          data: { githubInstallationId: null },
        });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: testRepositoryUrls.https,
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

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });
    });

    describe("Auto-linking scenarios", () => {
      test("should auto-link workspace to existing SourceControlOrg when GitHub owner matches", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        // Create workspace without sourceControlOrg link
        const workspace = await createTestWorkspace({
          name: "Unlinked Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: null,
          repositoryDraft: testRepositoryUrls.https, // Contains test-owner
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
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        // Verify workspace was auto-linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.https
        );
      });

      test("should return hasTokens=false when auto-linking fails (no matching SourceControlOrg)", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          name: "Unlinked Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: null,
          repositoryDraft: "https://github.com/nonexistent-owner/repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: false,
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

        // Verify workspace was NOT auto-linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
      });
    });

    describe("Multi-organization support scenarios", () => {
      test("should use workspace-specific org tokens when multiple orgs exist", async () => {
        const { testUser, sourceControlOrg: firstOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "first-org",
          });

        // Create second org with different installation
        const secondOrg = await db.sourceControlOrg.create({
          data: {
            githubLogin: "second-org",
            githubInstallationId: 999999,
            type: "ORG",
          },
        });

        const workspace = await createTestWorkspace({
          name: "First Org Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: firstOrg.id,
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

        expect(data.hasTokens).toBe(true);

        // Verify correct org's tokens were checked
        const sourceControlToken = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: firstOrg.id,
            },
          },
        });

        expect(sourceControlToken).not.toBeNull();
      });
    });

    describe("Error handling scenarios", () => {
      test("should return graceful response when getUserAppTokens throws error", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should return graceful response when checkRepositoryAccess throws error", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: testRepositoryUrls.https,
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
          new Error("GitHub API network error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // When checkRepositoryAccess throws, the catch block returns both as false (graceful degradation)
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should return graceful response when validateWorkspaceAccess throws error", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockRejectedValue(
          new Error("Workspace service error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should handle repository URL without GitHub owner gracefully", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: null,
          repositoryDraft: "https://gitlab.com/some-owner/repo", // Non-GitHub URL
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: false,
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
    });

    describe("Edge cases", () => {
      test("should handle workspace with repositoryDraft over primary repository", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: testRepositoryUrls.https,
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
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasRepoAccess).toBe(true);

        // Verify repositoryDraft was used
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.https
        );
      });

      test("should handle SSH repository URL format", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "nodejs",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
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

        expect(data.hasRepoAccess).toBe(true);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.ssh
        );
      });

      test("should handle repository URL with .git suffix", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
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

        expect(data.hasRepoAccess).toBe(true);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.httpsWithGit
        );
      });
    });
  });
});