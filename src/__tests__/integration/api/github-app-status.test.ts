import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
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
import { EncryptionService } from "@/lib/encryption";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock getUserAppTokens and checkRepositoryAccess from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

// Import the mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";

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
      test("should return {hasTokens:false, hasRepoAccess:false} for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
        expect(getUserAppTokens).not.toHaveBeenCalled();
      });

      test("should return {hasTokens:false, hasRepoAccess:false} for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Global token checks (no workspaceSlug)", () => {
      test("should return {hasTokens:true, hasRepoAccess:false} when user has global tokens", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

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
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No repo check without workspaceSlug

        // Verify getUserAppTokens was called correctly
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });

      test("should return {hasTokens:false, hasRepoAccess:false} when user has no tokens", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);

        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
      });

      test("should return {hasTokens:false, hasRepoAccess:false} when getUserAppTokens returns object without accessToken", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Workspace-specific token checks", () => {
      test("should return 403 when workspace access is denied", async () => {
        const testUser = await createTestUser();
        const otherUser = await createTestUser({ name: "Other User" });
        const workspace = await createTestWorkspace({
          ownerId: otherUser.id,
          slug: "other-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

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
      });

      test("should return {hasTokens:true, hasRepoAccess:false} for workspace with sourceControlOrg", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No repo URL provided

        expect(getUserAppTokens).not.toHaveBeenCalled(); // Workspace-specific check doesn't use global function
      });

      test("should return {hasTokens:false, hasRepoAccess:false} for workspace without tokens", async () => {
        const testUser = await createTestUser();

        // Create sourceControlOrg without tokens for this user
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "some-owner",
            githubInstallationId: 12345,
            name: "Some Owner",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-token-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);

        // Verify no token exists for this user + org
        const token = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg.id,
            },
          },
        });
        expect(token).toBeNull();
      });

      test("should return {hasTokens:false} for workspace without repository URL", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-repo-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(false);
        // API returns only hasTokens when no repo URL is found (line 188 of route.ts)
        expect(data.hasRepoAccess).toBeUndefined();
      });
    });

    describe("Auto-linking feature", () => {
      test("should auto-link workspace to existing SourceControlOrg when unlinked", async () => {
        const testUser = await createTestUser();

        // Create existing SourceControlOrg
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "auto-link-owner",
            githubInstallationId: 99999,
            name: "Auto Link Owner",
          },
        });

        // Create token for this user + org
        const encryptionService = EncryptionService.getInstance();
        await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: JSON.stringify(
              encryptionService.encryptField(
                "source_control_token",
                "test_access_token"
              )
            ),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        // Create workspace WITHOUT sourceControlOrgId
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "auto-link-workspace",
          repositoryDraft: "https://github.com/auto-link-owner/test-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock repository access check to return true
        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasRepoAccess).toBe(true); // Auto-linked workspace with installationId checks repo access

        // Verify workspace was auto-linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);

        // Verify checkRepositoryAccess was called with auto-linked data
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "99999",
          "https://github.com/auto-link-owner/test-repo"
        );
      });

      test("should return {hasTokens:false} when SourceControlOrg doesn't exist for GitHub owner", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-org-workspace",
          repositoryDraft: "https://github.com/non-existent-owner/test-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);

        // Verify workspace was NOT linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
      });

      test("should extract GitHub owner from HTTPS repository URL", async () => {
        const testUser = await createTestUser();

        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "https-owner",
            githubInstallationId: 11111,
            name: "HTTPS Owner",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "https-workspace",
          repositoryDraft: "https://github.com/https-owner/repo.git",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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

        // Verify workspace was linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });

      test("should extract GitHub owner from SSH repository URL", async () => {
        const testUser = await createTestUser();

        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "ssh-owner",
            githubInstallationId: 22222,
            name: "SSH Owner",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "ssh-workspace",
          repositoryDraft: "git@github.com:ssh-owner/repo.git",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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

        // Verify workspace was linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });
    });

    describe("Repository access verification", () => {
      test("should return {hasTokens:true, hasRepoAccess:true} with push permissions", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "push-owner",
          githubInstallationId: 55555,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "push-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/push-owner/push-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasRepoAccess).toBe(true);

        // Verify checkRepositoryAccess was called correctly
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "55555",
          "https://github.com/push-owner/push-repo"
        );
      });

      test("should return {hasTokens:true, hasRepoAccess:true} with admin permissions", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "admin-owner",
          githubInstallationId: 66666,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "admin-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/admin-owner/admin-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasRepoAccess).toBe(true);

        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "66666",
          "https://github.com/admin-owner/admin-repo"
        );
      });

      test("should return {hasTokens:true, hasRepoAccess:true} with maintain permissions", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "maintain-owner",
          githubInstallationId: 77777,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "maintain-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/maintain-owner/maintain-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasRepoAccess).toBe(true);
      });

      test("should return {hasTokens:true, hasRepoAccess:false} with only pull permissions", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "pull-owner",
          githubInstallationId: 88888,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "pull-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/pull-owner/pull-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

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
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should check repository access using provided repositoryUrl parameter", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "param-owner",
          githubInstallationId: 99999,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "param-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/param-owner/param-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(true);

        // Verify checkRepositoryAccess used the provided repositoryUrl
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "99999",
          "https://github.com/param-owner/param-repo"
        );
      });

      test("should skip repository access check when no repositoryUrl available", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "no-url-owner",
          githubInstallationId: 11111,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-url-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          // No repositoryDraft or primary repository
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false);

        // Verify checkRepositoryAccess was NOT called
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });
    });

    describe("Error handling and edge cases", () => {
      test("should handle errors gracefully and return {hasTokens:false, hasRepoAccess:false}", async () => {
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
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle checkRepositoryAccess errors gracefully", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "error-owner",
          githubInstallationId: 22222,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "error-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/error-owner/error-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockRejectedValue(
          new Error("GitHub API error")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        // Should still return successful response with tokens but failed repo access
        expect(response.status).toBe(200);
        expect(data.hasTokens).toBe(false); // Error in flow results in false
        expect(data.hasRepoAccess).toBe(false);
      });

      test("should handle invalid workspace slug gracefully", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/status",
          {
            workspaceSlug: "non-existent-workspace-12345",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe("Workspace not found or access denied");
      });

      // NOTE: This test is disabled because githubInstallationId is required (not nullable) in the Prisma schema.
      // The scenario "sourceControlOrg without installationId" cannot exist in the database.
      // If this constraint changes in the future, re-enable this test.
      test.skip("should handle workspace with sourceControlOrg but no installationId", async () => {
        const testUser = await createTestUser();

        // Create SourceControlOrg without githubInstallationId
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "no-install-owner",
            name: "No Installation Owner",
            githubInstallationId: 12345, // Required field
          },
        });

        const encryptionService = EncryptionService.getInstance();
        await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: JSON.stringify(
              encryptionService.encryptField(
                "source_control_token",
                "test_token"
              )
            ),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-install-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/no-install-owner/test-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
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
        expect(data.hasTokens).toBe(true);
        expect(data.hasRepoAccess).toBe(false); // No installationId = no repo check

        // Verify checkRepositoryAccess was NOT called
        expect(checkRepositoryAccess).not.toHaveBeenCalled();
      });

      test("should handle workspace member access (non-owner)", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const member = await createTestUser({ name: "Workspace Member" });

        const { sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "shared-owner",
          userId: owner.id,
        });

        const workspace = await createTestWorkspace({
          ownerId: owner.id,
          slug: "shared-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        // Add member to workspace
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: member.id,
            role: "DEVELOPER",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(member)
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
        // Member doesn't have tokens for this org
        expect(data.hasTokens).toBe(false);
        expect(data.hasRepoAccess).toBe(false);
      });
    });

    describe("Integration with auto-linking and repository access", () => {
      test("should auto-link workspace and check repository access in single request", async () => {
        const testUser = await createTestUser();

        // Create existing SourceControlOrg with installationId
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "full-flow-owner",
            githubInstallationId: 33333,
            name: "Full Flow Owner",
          },
        });

        // Create token for this user + org
        const encryptionService = EncryptionService.getInstance();
        await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: JSON.stringify(
              encryptionService.encryptField(
                "source_control_token",
                "test_access_token"
              )
            ),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        // Create workspace WITHOUT sourceControlOrgId but WITH repositoryDraft
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "full-flow-workspace",
          repositoryDraft: "https://github.com/full-flow-owner/test-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

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
        expect(data.hasRepoAccess).toBe(true);

        // Verify workspace was auto-linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);

        // Verify checkRepositoryAccess was called with auto-linked data
        expect(checkRepositoryAccess).toHaveBeenCalledWith(
          testUser.id,
          "33333",
          "https://github.com/full-flow-owner/test-repo"
        );
      });
    });
  });
});
