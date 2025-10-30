import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectUnauthorized,
  createGetRequest,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { workspaceAccessMocks } from "@/__tests__/support/helpers/service-mocks/workspace-mocks";
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
    describe("Authentication scenarios", () => {
      test("should return hasTokens: false and hasRepoAccess: false for unauthenticated users", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        // Verify no downstream calls were made
        expect(vi.mocked(getUserAppTokens)).not.toHaveBeenCalled();
        expect(vi.mocked(checkRepositoryAccess)).not.toHaveBeenCalled();
        expect(vi.mocked(validateWorkspaceAccess)).not.toHaveBeenCalled();
      });

      test("should return hasTokens: false for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        expect(vi.mocked(getUserAppTokens)).not.toHaveBeenCalled();
      });
    });

    describe("Global mode - no workspace specified", () => {
      test("should return hasTokens: true when user has GitHub App tokens", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return tokens
        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "ghu_test_token_123",
          refreshToken: "ghu_refresh_token_456",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: true,
          hasRepoAccess: false,
        });

        // Verify getUserAppTokens was called with userId only (no githubOwner)
        expect(vi.mocked(getUserAppTokens)).toHaveBeenCalledWith(testUser.id);
        expect(vi.mocked(checkRepositoryAccess)).not.toHaveBeenCalled();
      });

      test("should return hasTokens: false when user has no GitHub App tokens", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return null (no tokens)
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });

        expect(vi.mocked(getUserAppTokens)).toHaveBeenCalledWith(testUser.id);
      });

      test("should return hasTokens: false when getUserAppTokens returns object without accessToken", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "ghu_refresh_token_456",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
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

    describe("Workspace mode - workspace access validation", () => {
      test("should return 403 when user lacks workspace access", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock validateWorkspaceAccess to deny access
        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
          workspace: undefined,
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
        expect(data).toEqual({
          error: "Workspace not found or access denied",
        });

        // Verify validateWorkspaceAccess was called
        expect(vi.mocked(validateWorkspaceAccess)).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );

        // Verify no downstream token checks
        expect(vi.mocked(getUserAppTokens)).not.toHaveBeenCalled();
      });

      test("should proceed with token check when workspace access is granted", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock validateWorkspaceAccess to grant access
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBeDefined();
        expect(data.hasRepoAccess).toBeDefined();

        expect(vi.mocked(validateWorkspaceAccess)).toHaveBeenCalledWith(
          workspace.slug,
          testUser.id
        );
      });
    });

    describe("Workspace mode - linked SourceControlOrg", () => {
      test("should return hasTokens: true when workspace has linked SourceControlOrg with user tokens", async () => {
        const {
          testUser,
          sourceControlOrg,
          sourceControlToken,
        } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          sourceControlOrgId: sourceControlOrg.id,
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No repository URL provided
      });

      test("should return hasTokens: false when workspace has linked SourceControlOrg but user has no tokens", async () => {
        const { sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        // Create a different user without tokens
        const testUser = await createTestUser({ name: "User Without Tokens" });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          sourceControlOrgId: sourceControlOrg.id,
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Workspace mode - auto-linking", () => {
      test("should auto-link workspace to existing SourceControlOrg and check tokens", async () => {
        const {
          testUser,
          sourceControlOrg,
        } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        // Create workspace WITHOUT sourceControlOrgId
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          repositoryDraft: testRepositoryUrls.https, // Contains "test-owner"
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(true);

        // Verify workspace was auto-linked to sourceControlOrg
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });

      test("should return hasTokens: false when SourceControlOrg does not exist for GitHub owner", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          repositoryDraft: "https://github.com/nonexistent-owner/test-repo",
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
      });

      test("should return hasTokens: false when workspace has no repository URL", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          // No repositoryDraft set
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
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
      });
    });

    describe("Repository access verification", () => {
      test("should check repository access when tokens and repositoryUrl are provided", async () => {
        const {
          testUser,
          sourceControlOrg,
        } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
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
          canAdmin: true,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        // Mock checkRepositoryAccess to return true
        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        // Verify checkRepositoryAccess was called with correct parameters
        expect(vi.mocked(checkRepositoryAccess)).toHaveBeenCalledWith(
          testUser.id,
          sourceControlOrg.githubInstallationId.toString(),
          testRepositoryUrls.https
        );
      });

      test("should return hasRepoAccess: false when checkRepositoryAccess returns false", async () => {
        const {
          testUser,
          sourceControlOrg,
        } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
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
          canAdmin: true,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        // Mock checkRepositoryAccess to return false (no access)
        vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

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
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);
      });

      // Note: Test removed because githubInstallationId is non-nullable in the schema.
      // The API code already handles the case where sourceControlOrg doesn't exist,
      // which is tested in other scenarios.
    });

    describe("Error handling", () => {
      test("should return fail-safe response when getUserAppTokens throws error", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          hasTokens: false,
          hasRepoAccess: false,
        });
      });

      test("should return fail-safe response when validateWorkspaceAccess throws error", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock validateWorkspaceAccess to throw an error
        vi.mocked(validateWorkspaceAccess).mockRejectedValue(
          new Error("Validation service unavailable")
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

      test("should return fail-safe response when checkRepositoryAccess throws error", async () => {
        const {
          testUser,
          sourceControlOrg,
        } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
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
          canAdmin: true,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            slug: workspace.slug,
            ownerId: workspace.ownerId,
            createdAt: workspace.createdAt.toISOString(),
            updatedAt: workspace.updatedAt.toISOString(),
          },
          userRole: "OWNER",
        });

        // Mock checkRepositoryAccess to throw an error
        vi.mocked(checkRepositoryAccess).mockRejectedValue(
          new Error("GitHub API timeout")
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
  });
});