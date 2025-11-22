import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/github/app/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Import mocked functions
import { getServerSession } from "next-auth/next";
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";

describe("GET /api/github/app/status", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; sourceControlOrgId: string | null };
  let testSourceControlOrg: { id: string; githubLogin: string; githubInstallationId: number };
  let mockFetch: ReturnType<typeof vi.fn>;
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Create test user
    testUser = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    // Create test SourceControlOrg
    testSourceControlOrg = await db.sourceControlOrg.create({
      data: {
        type: "ORG",
        githubLogin: "test-owner",
        githubInstallationId: 12345,
        name: "Test Organization",
      },
    });

    // Create test workspace (initially unlinked)
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
        ownerId: testUser.id,
        sourceControlOrgId: null,
        repositoryDraft: "https://github.com/test-owner/test-repo",
      },
    });

    // Create workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.workspaceMember.deleteMany({
      where: { userId: testUser.id },
    });
    await db.sourceControlToken.deleteMany({
      where: { userId: testUser.id },
    });
    await db.workspace.deleteMany({
      where: { ownerId: testUser.id },
    });
    await db.sourceControlOrg.deleteMany({
      where: { githubLogin: "test-owner" },
    });
    await db.user.delete({
      where: { id: testUser.id },
    });
  });

  // Helper to create request with query params
  const createRequest = (params: Record<string, string> = {}) => {
    const url = new URL("http://localhost:3000/api/github/app/status");
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  };

  describe("Authentication", () => {
    it("returns hasTokens: false and hasRepoAccess: false when user is not authenticated", async () => {
      // Mock unauthenticated session
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    it("returns hasTokens: false and hasRepoAccess: false when session has no user ID", async () => {
      // Mock session without user ID
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });
  });

  describe("Token Retrieval - Global (No Workspace)", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);
    });

    it("returns hasTokens: false when user has no GitHub App tokens", async () => {
      // Mock getUserAppTokens to return null
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
      expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
    });

    it("returns hasTokens: true when user has valid GitHub App tokens", async () => {
      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock getUserAppTokens to return tokens
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_test_token",
        refreshToken: undefined,
      });

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id);
    });
  });

  describe("Workspace-Specific Token Retrieval", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);
    });

    it("returns 403 when workspace access is denied", async () => {
      // Mock workspace access validation failure
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
        workspace: null,
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(validateWorkspaceAccess).toHaveBeenCalledWith(testWorkspace.slug, testUser.id);
    });

    it("returns hasTokens: false when workspace is linked but user has no tokens for that org", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });

    it("returns hasTokens: true when workspace is linked and user has tokens for that org", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
    });
  });

  describe("Auto-Linking Feature", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });
    });

    it("automatically links workspace to SourceControlOrg when extracted from repository URL", async () => {
      // Ensure workspace is unlinked
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: null },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      await response.json();

      // Verify workspace was linked
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });

      expect(updatedWorkspace?.sourceControlOrgId).toBe(testSourceControlOrg.id);
    });

    it("returns hasTokens: false when workspace cannot be linked (no matching SourceControlOrg)", async () => {
      // Update workspace with non-existent GitHub owner
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "https://github.com/non-existent-owner/repo",
        },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });
  });

  describe("Repository Access Verification", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });
    });

    it("returns hasRepoAccess: true when user has access to repository", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock checkRepositoryAccess to return true
      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        testSourceControlOrg.githubInstallationId.toString(),
        "https://github.com/test-owner/test-repo"
      );
    });

    it("returns hasRepoAccess: false when user does not have access to repository", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock checkRepositoryAccess to return false
      vi.mocked(checkRepositoryAccess).mockResolvedValue(false);

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("uses repositoryUrl query parameter when provided", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock checkRepositoryAccess to return true
      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const customRepoUrl = "https://github.com/test-owner/custom-repo";
      const request = createRequest({
        workspaceSlug: testWorkspace.slug,
        repositoryUrl: customRepoUrl,
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasRepoAccess).toBe(true);
      expect(checkRepositoryAccess).toHaveBeenCalledWith(
        testUser.id,
        testSourceControlOrg.githubInstallationId.toString(),
        customRepoUrl
      );
    });
  });

  describe("Repository URL Parsing", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });
    });

    it("handles HTTPS GitHub URL format", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          repositoryDraft: "https://github.com/test-owner/test-repo",
        },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      await response.json();

      // Verify workspace was linked with correct GitHub owner
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });

      expect(updatedWorkspace?.sourceControlOrgId).toBe(testSourceControlOrg.id);
    });

    it("handles SSH GitHub URL format", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          repositoryDraft: "git@github.com:test-owner/test-repo.git",
        },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      await response.json();

      // Verify workspace was linked with correct GitHub owner
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });

      expect(updatedWorkspace?.sourceControlOrgId).toBe(testSourceControlOrg.id);
    });

    it("handles invalid repository URL gracefully", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "not-a-valid-url",
        },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });

    it("handles non-GitHub repository URL", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "https://gitlab.com/test-owner/test-repo",
        },
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);
    });

    it("returns hasTokens: false when token decryption fails", async () => {
      // Mock getUserAppTokens to return null (simulating decryption failure)
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });

    it("returns hasTokens: false and hasRepoAccess: false when unexpected error occurs", async () => {
      // Mock getUserAppTokens to throw an error
      vi.mocked(getUserAppTokens).mockRejectedValue(new Error("Database connection failed"));

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    it("handles validateWorkspaceAccess throwing an error", async () => {
      // Mock validateWorkspaceAccess to throw an error
      vi.mocked(validateWorkspaceAccess).mockRejectedValue(new Error("Workspace query failed"));

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    it("handles checkRepositoryAccess throwing an error", async () => {
      // Link workspace to SourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Create encrypted token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      // Mock checkRepositoryAccess to throw an error
      vi.mocked(checkRepositoryAccess).mockRejectedValue(new Error("GitHub API error"));

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // When checkRepositoryAccess throws, the catch block returns both as false
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });
  });

  describe("Multiple Installations", () => {
    let secondSourceControlOrg: { id: string; githubLogin: string; githubInstallationId: number };
    let secondWorkspace: { id: string; slug: string; sourceControlOrgId: string | null };

    beforeEach(async () => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);

      // Create second SourceControlOrg
      secondSourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: "ORG",
          githubLogin: "second-owner",
          githubInstallationId: 67890,
          name: "Second Organization",
        },
      });

      // Create second workspace
      secondWorkspace = await db.workspace.create({
        data: {
          name: "Second Workspace",
          slug: `second-workspace-${Date.now()}`,
          ownerId: testUser.id,
          sourceControlOrgId: secondSourceControlOrg.id,
          repositoryDraft: "https://github.com/second-owner/second-repo",
        },
      });

      // Create workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: secondWorkspace.id,
          userId: testUser.id,
          role: "OWNER",
        },
      });
    });

    afterEach(async () => {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: secondWorkspace.id },
      });
      await db.workspace.delete({
        where: { id: secondWorkspace.id },
      });
      await db.sourceControlOrg.delete({
        where: { id: secondSourceControlOrg.id },
      });
    });

    it("correctly identifies tokens for specific workspace when user has multiple installations", async () => {
      // Create tokens for both orgs
      const encryptedToken1 = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_token_org1")
      );
      const encryptedToken2 = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_token_org2")
      );

      await db.sourceControlToken.createMany({
        data: [
          {
            userId: testUser.id,
            sourceControlOrgId: testSourceControlOrg.id,
            token: encryptedToken1,
          },
          {
            userId: testUser.id,
            sourceControlOrgId: secondSourceControlOrg.id,
            token: encryptedToken2,
          },
        ],
      });

      // Link first workspace to first org
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Mock workspace access validation success for first workspace
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      // Mock checkRepositoryAccess to return true
      vi.mocked(checkRepositoryAccess).mockResolvedValue(true);

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
    });

    it("returns hasTokens: false for workspace when user has tokens for different org", async () => {
      // Create token only for second org
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_token_org2")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: secondSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Link first workspace to first org (which has no tokens)
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      // Mock workspace access validation success for first workspace
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: testUser.id, email: testUser.email, name: testUser.name },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);
    });

    it.skip("skips repository access check when workspace has no installation ID - SKIPPED: schema requires non-null githubInstallationId", async () => {
      // This test is skipped because the Prisma schema enforces githubInstallationId as required (Int, not Int?)
      // In practice, SourceControlOrg records always have an installation ID
      // The edge case this test was trying to cover cannot occur in production
    });

    it("skips repository access check when workspace has no repository URL", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: testSourceControlOrg.id,
          repositoryDraft: null,
        },
      });

      // Create token
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", "ghu_test_token")
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: encryptedToken,
        },
      });

      // Mock workspace access validation success
      vi.mocked(validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
          ownerId: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      });

      const request = createRequest({ workspaceSlug: testWorkspace.slug });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
      expect(checkRepositoryAccess).not.toHaveBeenCalled();
    });
  });
});