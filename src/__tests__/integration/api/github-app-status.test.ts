import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { User, Workspace, WorkspaceMember, SourceControlOrg, SourceControlToken } from "@prisma/client";

// Test setup utilities
let testUser: User;
let testWorkspace: Workspace;
let testSourceControlOrg: SourceControlOrg;
let encryptionService: EncryptionService;

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock NextAuth session
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

const { getServerSession } = await import("next-auth/next");
const mockGetServerSession = getServerSession as ReturnType<typeof vi.fn>;

// Import the route handler after mocking
const { GET } = await import("@/app/api/github/app/status/route");

describe("GitHub App Status Endpoint Integration Tests", () => {
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Initialize encryption service
    encryptionService = EncryptionService.getInstance();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
        emailVerified: new Date(),
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: testUser.id,
      },
    });

    // Create test SourceControlOrg
    testSourceControlOrg = await db.sourceControlOrg.create({
      data: {
        githubLogin: "test-org",
        githubInstallationId: 12345678,
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.sourceControlToken.deleteMany({ where: { userId: testUser.id } });
    await db.sourceControlOrg.deleteMany({ where: { id: testSourceControlOrg.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  describe("Phase 1: Authentication", () => {
    it("should return false flags when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new Request("https://example.com/api/github/app/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    it("should return false flags when session exists but user id is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" },
      });

      const request = new Request("https://example.com/api/github/app/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        hasTokens: false,
        hasRepoAccess: false,
      });
    });

    it("should proceed to workspace validation when user is authenticated", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);

      expect(response.status).not.toBe(401);
      expect(mockGetServerSession).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe("Phase 2: Workspace Validation", () => {
    it("should return 403 when workspace does not exist", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        "https://example.com/api/github/app/status?workspaceSlug=non-existent-workspace"
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toHaveProperty("error");
    });

    it("should return 403 when user is not a workspace member", async () => {
      const otherUser = await db.user.create({
        data: {
          email: "other@example.com",
          name: "Other User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toHaveProperty("error");

      await db.user.delete({ where: { id: otherUser.id } });
    });

    it("should proceed to token verification when user is workspace owner", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("hasTokens");
      // When no repository URL is provided and workspace has no sourceControlOrg,
      // the API returns early with only hasTokens (no hasRepoAccess property)
      expect(data.hasTokens).toBe(false);
    });

    it("should proceed when user is workspace member with appropriate role", async () => {
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: testUser.id,
          role: "DEVELOPER",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("should check global tokens when no workspaceSlug provided", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request("https://example.com/api/github/app/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("hasTokens");
      expect(data.hasRepoAccess).toBe(false); // No repo check without workspace
    });
  });

  describe("Phase 3: Token Verification", () => {
    beforeEach(async () => {
      // Link workspace to sourceControlOrg
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });
    });

    it("should return hasTokens: true when user has encrypted tokens", async () => {
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-access-token-123"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
    });

    it("should return hasTokens: false when user has no tokens", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should decrypt tokens correctly when checking repo access", async () => {
      const originalToken = "test-access-token-456";
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        originalToken
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { repositoryDraft: "https://github.com/test-org/test-repo" },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/test-repo",
              private: true,
              permissions: { push: true },
            },
          ],
        }),
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      // Token decryption happens internally when checking repo access
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/user/installations/12345678/repositories"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );
    });

    it("should handle workspace without sourceControlOrg gracefully", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: null },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });

    it("should isolate tokens per user and org", async () => {
      const otherUser = await db.user.create({
        data: {
          email: "other@example.com",
          name: "Other User",
        },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "other-user-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: otherUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(false); // testUser should not see otherUser's tokens

      await db.sourceControlToken.deleteMany({ where: { userId: otherUser.id } });
      await db.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe("Phase 4: Repository Access", () => {
    beforeEach(async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-access-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });
    });

    it("should return hasRepoAccess: true when repository is accessible", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/test-repo",
              private: true,
              permissions: {
                push: true,
                admin: false,
                maintain: false,
              },
            },
          ],
        }),
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=https://github.com/test-org/test-repo`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/user/installations/12345678/repositories"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );
    });

    it("should return hasRepoAccess: false when repository is not in accessible list", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/other-repo",
              private: true,
              permissions: { push: true },
            },
          ],
        }),
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=https://github.com/test-org/test-repo`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should return hasRepoAccess: false when GitHub API returns error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Access denied",
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=https://github.com/test-org/test-repo`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should skip repo access check when no repository URL provided", async () => {
      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip repo access check when installationId is missing", async () => {
      // Delete and recreate the org without installationId by using a different org
      const orgWithoutInstallation = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org-no-install",
          githubInstallationId: 0, // Use 0 to represent missing/invalid installation
        },
      });

      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: orgWithoutInstallation.id },
      });

      // Move token to the new org
      await db.sourceControlToken.deleteMany({ 
        where: { 
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id 
        } 
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-access-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: orgWithoutInstallation.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=https://github.com/test-org/test-repo`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      await db.sourceControlToken.deleteMany({ where: { userId: testUser.id } });
      await db.sourceControlOrg.delete({ where: { id: orgWithoutInstallation.id } });
    });

    it("should use repositoryDraft as fallback when no repositoryUrl param", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { repositoryDraft: "https://github.com/test-org/draft-repo" },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/draft-repo",
              private: true,
              permissions: { push: true },
            },
          ],
        }),
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasRepoAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/user/installations/12345678/repositories"),
        expect.anything()
      );
    });

    it("should use primary repository as final fallback", async () => {
      await db.repository.create({
        data: {
          workspaceId: testWorkspace.id,
          name: "Primary Repo",
          repositoryUrl: "https://github.com/test-org/primary-repo",
          branch: "main",
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/primary-repo",
              private: true,
              permissions: { admin: true },
            },
          ],
        }),
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasRepoAccess).toBe(true);
    });
  });

  describe("Auto-linking Behavior", () => {
    it("should auto-link workspace to sourceControlOrg when repository matches", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "https://github.com/test-org/test-repo",
        },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      // Verify workspace was auto-linked
      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });

      expect(updatedWorkspace?.sourceControlOrgId).toBe(testSourceControlOrg.id);
      expect(data.hasTokens).toBe(true);
    });

    it("should not auto-link when no matching sourceControlOrg exists", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "https://github.com/non-existent-org/repo",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      const workspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });

      expect(workspace?.sourceControlOrgId).toBeNull();
      expect(data.hasTokens).toBe(false);
    });

    it("should check repo access after auto-linking", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: "https://github.com/test-org/auto-link-repo",
        },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            {
              full_name: "test-org/auto-link-repo",
              private: true,
              permissions: { push: true },
            },
          ],
        }),
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("should handle invalid repository URL format gracefully", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=invalid-url`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should return graceful error when EncryptionService fails during repo access check", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: testSourceControlOrg.id,
          repositoryDraft: "https://github.com/test-org/test-repo",
        },
      });

      // Create malformed encrypted token
      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify({ data: "invalid", iv: "bad", tag: "wrong" }),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Token record exists but decryption fails when checking repo access
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should handle GitHub API network error gracefully", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { sourceControlOrgId: testSourceControlOrg.id },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}&repositoryUrl=https://github.com/test-org/test-repo`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(true);
      expect(data.hasRepoAccess).toBe(false);
    });

    it("should handle database query error gracefully", async () => {
      // Mock database error by destroying connection temporarily
      const findUniqueSpy = vi.spyOn(db.workspace, "findUnique");
      findUniqueSpy.mockRejectedValueOnce(new Error("Database connection error"));

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);

      findUniqueSpy.mockRestore();
    });

    it("should handle missing repositoryUrl and no fallbacks", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: null,
          repositoryDraft: null,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
    });
  });

  describe("Security Controls", () => {
    it("should ensure workspace isolation - user cannot access other user's workspace", async () => {
      const otherUser = await db.user.create({
        data: {
          email: "other@example.com",
          name: "Other User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toHaveProperty("error");

      await db.user.delete({ where: { id: otherUser.id } });
    });

    it("should ensure token isolation - user A cannot see user B's tokens", async () => {
      const userA = await db.user.create({
        data: { email: "usera@example.com", name: "User A" },
      });

      const userB = await db.user.create({
        data: { email: "userb@example.com", name: "User B" },
      });

      const workspaceA = await db.workspace.create({
        data: {
          name: "Workspace A",
          slug: "workspace-a",
          ownerId: userA.id,
          sourceControlOrgId: testSourceControlOrg.id,
        },
      });

      const encryptedTokenB = encryptionService.encryptField(
        "source_control_token",
        "user-b-secret-token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: userB.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedTokenB),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: userA.id, email: userA.email },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=workspace-a`
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.hasTokens).toBe(false); // User A should not see User B's tokens

      await db.sourceControlToken.deleteMany({ where: { userId: userB.id } });
      await db.workspace.delete({ where: { id: workspaceA.id } });
      await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    });

    it("should validate encryption roundtrip - store and retrieve tokens correctly", async () => {
      const originalToken = "super-secret-github-token-12345";
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        originalToken
      );

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      // Retrieve and decrypt
      const storedToken = await db.sourceControlToken.findUnique({
        where: {
          userId_sourceControlOrgId: {
            userId: testUser.id,
            sourceControlOrgId: testSourceControlOrg.id,
          },
        },
      });

      expect(storedToken).not.toBeNull();
      expect(storedToken!.token).not.toBe(originalToken); // Should be encrypted

      const decryptedToken = encryptionService.decryptField(
        "source_control_token",
        storedToken!.token
      );

      expect(decryptedToken).toBe(originalToken);
    });

    it("should verify encrypted token format has all required fields", async () => {
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test-token"
      );

      expect(encryptedToken).toHaveProperty("data");
      expect(encryptedToken).toHaveProperty("iv");
      expect(encryptedToken).toHaveProperty("tag");
      expect(encryptedToken).toHaveProperty("version");
      expect(encryptedToken).toHaveProperty("encryptedAt");

      expect(typeof encryptedToken.data).toBe("string");
      expect(typeof encryptedToken.iv).toBe("string");
      expect(typeof encryptedToken.tag).toBe("string");
      expect(encryptedToken.data.length).toBeGreaterThan(0);
      expect(encryptedToken.iv.length).toBeGreaterThan(0);
      expect(encryptedToken.tag.length).toBeGreaterThan(0);
    });

    it("should detect tampered encrypted tokens when checking repo access", async () => {
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "original-token"
      );

      // Tamper with the tag
      const tamperedToken = {
        ...encryptedToken,
        tag: encryptedToken.tag.slice(0, -4) + "AAAA",
      };

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: testSourceControlOrg.id,
          token: JSON.stringify(tamperedToken),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: {
          sourceControlOrgId: testSourceControlOrg.id,
          repositoryDraft: "https://github.com/test-org/test-repo",
        },
      });

      const request = new Request(
        `https://example.com/api/github/app/status?workspaceSlug=${testWorkspace.slug}`
      );
      const response = await GET(request);
      const data = await response.json();

      // The route's catch block returns false/false when any error occurs during processing
      expect(response.status).toBe(200);
      expect(data.hasTokens).toBe(false);
      expect(data.hasRepoAccess).toBe(false);
    });
  });
});