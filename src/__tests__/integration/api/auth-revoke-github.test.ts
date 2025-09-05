import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/auth/revoke-github/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

describe("GitHub Revoke Auth API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithGitHubAccount() {
    // Use a transaction to ensure atomicity
    return await db.$transaction(async (tx) => {
      // Create test user with real database operations
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create GitHub account with encrypted access token
      const encryptedToken = encryptionService.encryptField("access_token", "github_pat_test_token_12345");
      const testAccount = await tx.account.create({
        data: {
          id: `test-account-${Date.now()}-${Math.random()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `${Date.now()}`,
          access_token: JSON.stringify(encryptedToken),
        },
      });

      const testGitHubAuth = await tx.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "123456",
          githubUsername: "testuser",
          githubNodeId: "U_test123",
          name: "Test User",
          publicRepos: 5,
          followers: 10,
          following: 5,
          accountType: "User",
        },
      });

      // Create session for the user
      const testSession = await tx.session.create({
        data: {
          id: `test-session-${Date.now()}-${Math.random()}`,
          userId: testUser.id,
          expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          sessionToken: `session-token-${Date.now()}`,
        },
      });

      return { testUser, testAccount, testGitHubAuth, testSession };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("POST /api/auth/revoke-github", () => {
    test("should successfully revoke GitHub access and clean up data", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();
      
      // Mock session with real user
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful GitHub token revocation
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was called with proper authorization
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: expect.stringContaining("github_pat_test_token_12345"),
        })
      );

      // Verify account was deleted from database
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Verify GitHub auth was deleted from database
      const deletedGitHubAuth = await db.gitHubAuth.findFirst({
        where: { id: testGitHubAuth.id },
      });
      expect(deletedGitHubAuth).toBeNull();

      // Verify session was deleted from database
      const deletedSession = await db.session.findFirst({
        where: { id: testSession.id },
      });
      expect(deletedSession).toBeNull();
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for user without valid ID", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when no GitHub account found", async () => {
      // Create user without GitHub account
      const userWithoutGitHub = await db.user.create({
        data: {
          id: "user-no-github",
          email: "noauth@example.com",
          name: "No Auth User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: userWithoutGitHub.id, email: userWithoutGitHub.email },
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "No GitHub account found",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle GitHub API revocation failure gracefully", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock GitHub API failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();
      const data = await response.json();

      // Should still succeed even if GitHub revocation fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was attempted
      expect(mockFetch).toHaveBeenCalled();

      // Verify local cleanup still happened
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should handle network errors during GitHub API call", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();
      const data = await response.json();

      // Should still succeed even with network error
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify local cleanup still happened
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should properly decrypt and use access token", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      await POST();

      // Verify the stored token is encrypted (doesn't contain plain text)
      const storedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      
      // Account should be deleted by now, but we verified encryption in setup
      expect(storedAccount).toBeNull();

      // Verify GitHub API was called with decrypted token
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          body: expect.stringContaining("github_pat_test_token_12345"),
        })
      );
    });

    test("should handle account without access token", async () => {
      const testUser = await db.user.create({
        data: {
          id: `test-user-no-token-${Date.now()}`,
          email: `test-no-token-${Date.now()}@example.com`,
          name: "Test User No Token",
        },
      });

      // Create GitHub account without access token
      await db.account.create({
        data: {
          id: `test-account-no-token-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `${Date.now()}`,
          // No access_token field
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Should not have called GitHub API without token
      expect(mockFetch).not.toHaveBeenCalled();

      // Should still have cleaned up local data
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should return 500 for database errors", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock database to throw error on account lookup
      const originalFindFirst = db.account.findFirst;
      vi.spyOn(db.account, 'findFirst').mockRejectedValue(new Error("Database connection failed"));

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
      });
      
      const response = await POST();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to revoke GitHub access",
      });

      // Restore original method
      db.account.findFirst = originalFindFirst;
    });
  });
});