import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectForbidden,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

// Mock external dependencies
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
  refreshAndUpdateAccessTokens: vi.fn(),
  checkRepositoryPermissions: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
  getWorkspaceBySlug: vi.fn(),
  getUserWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
}));

describe("GET /api/github/app/status - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("returns false values for unauthenticated users", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });
  });

  describe("Global Token Check (No Workspace)", () => {
    test("returns hasTokens: true when user has tokens", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      (getUserAppTokens as any).mockResolvedValue({
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
      });

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: false,
      });
      expect(getUserAppTokens).toHaveBeenCalledWith(user.id);
    });

    test("returns hasTokens: false when user has no tokens", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      (getUserAppTokens as any).mockResolvedValue(null);

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });
  });

  describe("Workspace-Specific Token Check", () => {
    test("returns hasTokens: true when workspace has sourceControlOrg with user tokens", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: false,
      });
    });

    test("returns hasTokens: false when workspace has sourceControlOrg but user has no tokens", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // No token for user

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    test("returns 403 when user lacks workspace access", async () => {
      const user = await createTestUser();
      const otherUser = await createTestUser({ email: "other@example.com" });
      const workspace = await createTestWorkspace({ ownerId: otherUser.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    test("handles workspace without sourceControlOrg and no repository URL", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // No sourceControlOrg linked

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
      });
    });
  });

  describe("Auto-Linking SourceControlOrg", () => {
    test("auto-links workspace to existing SourceControlOrg by githubLogin", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-owner",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Owner",
        },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent("https://github.com/test-owner/test-repo")}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      // API returns only hasTokens when auto-linking finds the org but no repo access check is performed
      expect(data).toEqual({
        hasTokens: true,
      });

      // Verify workspace was linked to org
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
    });

    test("returns hasTokens: false when SourceControlOrg doesn't exist for extracted githubLogin", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent("https://github.com/nonexistent-owner/test-repo")}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    test("auto-links and checks repository access when user has tokens", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "auto-link-org",
          githubInstallationId: 67890,
          type: "ORG",
          name: "Auto Link Org",
        },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });
      (checkRepositoryAccess as any).mockResolvedValue(true);

      const repositoryUrl = "https://github.com/auto-link-org/test-repo";
      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent(repositoryUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: true,
      });

      // Verify workspace was auto-linked
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);

      // Verify checkRepositoryAccess was called
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        user.id,
        "67890",
        repositoryUrl
      );
    });
  });

  describe("Repository Access Verification", () => {
    test("calls checkRepositoryAccess when tokens + repositoryUrl + installationId present", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });
      (checkRepositoryAccess as any).mockResolvedValue(true);

      const repositoryUrl = "https://github.com/test-org/test-repo";
      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent(repositoryUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: true,
      });
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        user.id,
        "12345",
        repositoryUrl
      );
    });

    test("returns hasRepoAccess: false when user has no access", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });
      (checkRepositoryAccess as any).mockResolvedValue(false);

      const repositoryUrl = "https://github.com/test-org/test-repo";
      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent(repositoryUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: false,
      });
    });

    test("skips repo check when tokens missing", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // No token for user

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });

      const repositoryUrl = "https://github.com/test-org/test-repo";
      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent(repositoryUrl)}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
      expect(checkRepositoryAccess).not.toHaveBeenCalled();
    });

    test("uses repositoryDraft when repositoryUrl not provided", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ 
        ownerId: user.id,
        repositoryDraft: "https://github.com/draft-org/draft-repo",
      });

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "draft-org",
          githubInstallationId: 54321,
          type: "ORG",
          name: "Draft Organization",
        },
      });

      // Link workspace to org
      await db.workspace.update({
        where: { id: workspace.id },
        data: { sourceControlOrgId: sourceControlOrg.id },
      });

      // Create token for user
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          scopes: ["repo"],
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockResolvedValue({
        hasAccess: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          description: workspace.description,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
      });
      (checkRepositoryAccess as any).mockResolvedValue(true);

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: true,
        hasRepoAccess: true,
      });

      // Verify checkRepositoryAccess was called with repositoryDraft
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        user.id,
        "54321",
        "https://github.com/draft-org/draft-repo"
      );
    });
  });

  describe("Error Handling", () => {
    test("returns 200 with false values on internal errors", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getUserAppTokens to throw an error
      (getUserAppTokens as any).mockRejectedValue(new Error("Database error"));

      const request = createGetRequest("http://localhost:3000/api/github/app/status");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    test("returns 200 with false values when validateWorkspaceAccess throws error", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      (validateWorkspaceAccess as any).mockRejectedValue(new Error("Validation error"));

      const request = createGetRequest(
        `http://localhost:3000/api/github/app/status?workspaceSlug=${workspace.slug}`
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });
  });
});