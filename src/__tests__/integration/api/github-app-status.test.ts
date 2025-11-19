import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectForbidden,
  getMockedSession,
  createGetRequest,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import {
  createTestUserWithGitHubTokens,
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { db } from "@/lib/db";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock workspace service
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

// Import mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create workspace access mock response
function createWorkspaceAccessMock(
  workspace: any,
  userRole: string = "OWNER",
  hasAccess: boolean = true
) {
  return {
    hasAccess,
    canRead: hasAccess,
    canWrite: hasAccess,
    canAdmin: hasAccess,
    workspace: workspace as any,
    userRole: userRole as any,
  };
}

// Helper to create denied workspace access mock
function createDeniedWorkspaceAccessMock() {
  return {
    hasAccess: false,
    canRead: false,
    canWrite: false,
    canAdmin: false,
  };
}

describe("GitHub App Status API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("GET /api/github/app/status", () => {
    describe("Authentication scenarios", () => {
      test("should return safe defaults for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return safe defaults for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Authorization scenarios", () => {
      test("should return 403 when workspace access is denied", async () => {
        const testUser = await createTestUser({ name: "Unauthorized User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "forbidden-workspace",
        });

        // Create another user who shouldn't have access
        const unauthorizedUser = await createTestUser({ name: "Other User" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(unauthorizedUser)
        );

        // Mock workspace validation to deny access
        vi.mocked(validateWorkspaceAccess).mockResolvedValue(
          createDeniedWorkspaceAccessMock()
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        await expectForbidden(response);

        expect(validateWorkspaceAccess).toHaveBeenCalledWith(
          workspace.slug,
          unauthorizedUser.id
        );
      });

      test("should allow workspace owner to check status", async () => {
        const { testUser } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "owner-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock workspace validation to succeed
        vi.mocked(validateWorkspaceAccess).mockResolvedValue(
          createWorkspaceAccessMock(workspace)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("hasTokens");
      });
    });

    describe("Token checking scenarios", () => {
      test("should return hasTokens=true when user has valid tokens for workspace org", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "token-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // Integration test: Workspace with sourceControlOrgId uses direct DB query
        expect(data.hasTokens).toBe(true);
      });

      test("should return hasTokens=false when user has no tokens", async () => {
        const testUser = await createTestUser({ name: "No Tokens User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-tokens-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

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

      test("should check global tokens when no workspace provided", async () => {
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
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });
    });

    describe("Repository access validation scenarios", () => {
      test("should return hasRepoAccess=true when user has push permissions", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 12345678,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "push-access-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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
          "12345678",
          testRepositoryUrls.https
        );
      });

      test("should return hasRepoAccess=false when repository not accessible", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 12345678,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-repo-access-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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

      test("should support SSH repository URL format", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "nodejs",
            githubInstallationId: 87654321,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "ssh-url-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "87654321",
          testRepositoryUrls.ssh
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 11111111,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "git-suffix-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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

      test("should skip repository access check when no repository URL provided", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-repo-url-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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

    describe("Auto-linking behavior", () => {
      test("should auto-link workspace to matching GitHub org when workspace not linked", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 99999999,
          });

        // Create workspace without sourceControlOrg link
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "unlinked-workspace",
          repositoryDraft: "https://github.com/test-owner/test-repo",
        });

        expect(workspace.sourceControlOrgId).toBeNull();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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

        // Verify workspace was linked to org
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });

      test("should extract GitHub owner from repositoryUrl parameter when auto-linking", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "another-owner",
            githubInstallationId: 88888888,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "auto-link-param-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/another-owner/some-repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);
      });

      test("should return hasTokens=false when auto-linking fails (no matching org)", async () => {
        const testUser = await createTestUser({ name: "User Without Org" });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-matching-org-workspace",
          repositoryDraft: "https://github.com/nonexistent-owner/repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

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

    describe("Edge cases and error handling", () => {
      test("should return hasRepoAccess=false for invalid GitHub URL", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 12345678,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "invalid-url-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock checkRepositoryAccess to return false for invalid URL
        vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(true);
        // Invalid URL will still trigger checkRepositoryAccess if installation ID exists
        // The function itself should return false for invalid URLs
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle checkRepositoryAccess throwing error", async () => {
        const { testUser, sourceControlOrg, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "test-owner",
            githubInstallationId: 12345678,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "access-error-workspace",
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
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
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
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle getUserAppTokens throwing error", async () => {
        // Test without workspace - this triggers the getUserAppTokens path
        const { testUser } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle missing workspace slug parameter", async () => {
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
        expect(data.hasRepoAccess).toBe(false);
        expect(validateWorkspaceAccess).not.toHaveBeenCalled();
      });
    });

    describe("Multi-org support scenarios", () => {
      test("should retrieve tokens for specific GitHub owner from multi-org user", async () => {
        const { testUser: user1, sourceControlOrg: org1 } =
          await createTestUserWithGitHubTokens({
            githubOwner: "org1",
            accessToken: "token_for_org1",
            githubInstallationId: 11111111,
          });

        // Create second org for same user
        const org2 = await db.sourceControlOrg.create({
          data: {
            githubLogin: "org2",
            githubInstallationId: 22222222,
            type: "ORG",
            name: "Organization 2",
          },
        });

        const { EncryptionService } = await import("@/lib/encryption");
        const encryptionService = EncryptionService.getInstance();
        const encryptedToken2 = encryptionService.encryptField(
          "source_control_token",
          "token_for_org2"
        );

        await db.sourceControlToken.create({
          data: {
            userId: user1.id,
            sourceControlOrgId: org2.id,
            token: JSON.stringify(encryptedToken2),
            scopes: ["repo"],
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: user1.id,
          slug: "multi-org-workspace",
          sourceControlOrgId: org2.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user1)
        );

        vi.mocked(validateWorkspaceAccess).mockResolvedValue({
          hasAccess: true,
          canRead: true,
          canWrite: true,
          canAdmin: true,
          workspace: workspace as any,
          userRole: "OWNER" as any,
        });

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/org2/repo",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // Integration test: Verify that user can access workspace with org2 tokens
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);
        // When workspace has sourceControlOrgId, route queries DB directly rather than calling getUserAppTokens
      });
    });
  });
});