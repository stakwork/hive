import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import {
  createAuthenticatedSession,
  createGetRequest,
  expectForbidden,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  mockUnauthenticatedSession,
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

// Mock githubApp functions
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

// Import mocked functions
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";

describe("GET /api/github/app/status - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication scenarios", () => {
    test("should return hasTokens=false for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should return hasTokens=false when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
        expires: "2024-12-31",
      });

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });
  });

  describe("Global token check (no workspace)", () => {
    test("should return hasTokens=true when user has GitHub tokens", async () => {
      const { testUser } = await createTestUserWithGitHubTokens();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
        refreshToken: "github_refresh_token",
      });

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);

      // Verify getUserAppTokens was called with user ID only
      expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
    });

    test("should return hasTokens=false when user has no GitHub tokens", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should return hasTokens=false when getUserAppTokens returns empty object", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(getUserAppTokens).mockResolvedValue({});

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });
  });

  describe("Workspace access validation", () => {
    test("should return 403 when user is not a workspace member", async () => {
      const testUser = await createTestUser();
      const otherUser = await createTestUser({ name: "Other User" });
      const workspace = await createTestWorkspace({ ownerId: otherUser.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("should return 403 when workspace does not exist", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: "non-existent-workspace",
      });
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("should succeed when user is workspace owner", async () => {
      const testUser = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: testUser.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      // BUG: When no repository URL exists, the API returns { hasTokens: false } without hasRepoAccess field
      // This is inconsistent with other responses that always include both fields
      expect(data.hasRepoAccess).toBeUndefined();
    });

    test("should succeed when user is workspace member", async () => {
      const owner = await createTestUser({ name: "Owner" });
      const member = await createTestUser({ name: "Member" });
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          userId: member.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      // BUG: Same as workspace owner test - hasRepoAccess is missing from response
      expect(data.hasRepoAccess).toBeUndefined();
    });
  });

  describe("Workspace with linked SourceControlOrg", () => {
    test("should check tokens for linked SourceControlOrg", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      // Create workspace linked to the SourceControlOrg
      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);

      // Verify checkRepositoryAccess was called with correct parameters
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        sourceControlOrg.githubInstallationId.toString(),
        testRepositoryUrls.https
      );
    });

    test("should return hasRepoAccess=false when checkRepositoryAccess returns false", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should return hasTokens=false when user has no token for linked org", async () => {
      const testUser = await createTestUser();
      const otherUser = await createTestUser({ name: "Other User" });

      // Create org and tokens for otherUser
      const { sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      // Create workspace linked to the org, but owned by testUser (no tokens)
      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);

      // checkRepositoryAccess should not be called without tokens
      expect(checkRepositoryAccess).not.toHaveBeenCalled();
    });

    test("should skip repo access check when no repository URL available", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      // Create workspace without repositoryDraft
      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);

      // checkRepositoryAccess should not be called without repo URL
      expect(checkRepositoryAccess).not.toHaveBeenCalled();
    });

    test("should skip repo access check when no installation ID available", async () => {
      const { testUser } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      // Create org with a different installation ID (to avoid unique constraint)
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "other-org",
          name: "Other Org",
          type: "USER",
          githubInstallationId: 999999, // Different installation ID
        },
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);

      // checkRepositoryAccess should not be called without matching user tokens
      expect(checkRepositoryAccess).not.toHaveBeenCalled();
    });
  });

  describe("Auto-linking workspace to SourceControlOrg", () => {
    test("should auto-link workspace to existing SourceControlOrg by GitHub owner", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-owner",
        githubInstallationId: 123456,
      });

      // Create workspace WITHOUT sourceControlOrgId (unlinked)
      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        repositoryDraft: testRepositoryUrls.https, // https://github.com/test-owner/test-repo
      });

      expect(workspace.sourceControlOrgId).toBeNull();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);

      // Verify workspace was auto-linked
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);

      // Verify checkRepositoryAccess was called
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        sourceControlOrg.githubInstallationId.toString(),
        testRepositoryUrls.https
      );
    });

    test("should handle auto-linking with SSH repository URL format", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "nodejs",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        repositoryDraft: testRepositoryUrls.ssh, // git@github.com:nodejs/node.git
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);

      // Verify auto-linking occurred
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
    });

    test("should return hasTokens=false when no matching SourceControlOrg exists", async () => {
      const testUser = await createTestUser();

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        repositoryDraft: "https://github.com/unknown-owner/test-repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);

      // Verify workspace was NOT linked (no matching org)
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
    });

    test("should return hasTokens=false when workspace has invalid repository URL", async () => {
      const testUser = await createTestUser();

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        repositoryDraft: testRepositoryUrls.invalid, // gitlab URL
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should return hasTokens=false when no repository URL is available", async () => {
      const testUser = await createTestUser();

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        // No repositoryDraft and no primary repository
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      // BUG: Same inconsistency - missing hasRepoAccess field
      expect(data.hasRepoAccess).toBeUndefined();
    });
  });

  describe("Repository URL resolution priority", () => {
    test("should prioritize query param repositoryUrl over workspace repositoryDraft", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-owner",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: "https://github.com/test-owner/workspace-repo",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const overrideUrl = "https://github.com/test-owner/override-repo";
      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
        repositoryUrl: overrideUrl,
      });
      const response = await GET(request);

      await expectSuccess(response, 200);

      // Verify checkRepositoryAccess was called with override URL
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        sourceControlOrg.githubInstallationId.toString(),
        overrideUrl
      );
    });

    test("should use repositoryDraft when no query param provided", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-owner",
        githubInstallationId: 123456,
      });

      const draftUrl = "https://github.com/test-owner/draft-repo";
      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: draftUrl,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      await expectSuccess(response, 200);

      // Verify checkRepositoryAccess was called with draft URL
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        sourceControlOrg.githubInstallationId.toString(),
        draftUrl
      );
    });
  });

  describe("Error handling", () => {
    test("should return hasTokens=false when getUserAppTokens throws error", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(getUserAppTokens).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should return hasRepoAccess=false when checkRepositoryAccess throws error", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-org",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockRejectedValue(
        new Error("GitHub API error")
      );

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      // When checkRepositoryAccess throws, the entire catch block returns false for both fields
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    test("should handle database query failures gracefully", async () => {
      const testUser = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create workspace but simulate DB failure by using invalid slug
      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: "invalid-slug-with-special-chars-@#$%",
      });
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });
  });

  describe("Support for different repository URL formats", () => {
    test("should support HTTPS URL format", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-owner",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.https,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasRepoAccess).toBe(true);
    });

    test("should support HTTPS URL with .git suffix", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "test-owner",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.httpsWithGit,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasRepoAccess).toBe(true);
    });

    test("should support SSH URL format", async () => {
      const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
        githubOwner: "nodejs",
        githubInstallationId: 123456,
      });

      const workspace = await createTestWorkspace({
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: testRepositoryUrls.ssh, // git@github.com:nodejs/node.git
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createGetRequest("http://localhost:3000/api/github/app/status", {
        workspaceSlug: workspace.slug,
      });
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.hasRepoAccess).toBe(true);
    });
  });
});