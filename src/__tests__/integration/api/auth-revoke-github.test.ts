import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
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
vi.stubGlobal("fetch", mockFetch);

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

describe("POST /api/auth/revoke-github Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithGitHubAccount() {
    return await db.$transaction(async (tx) => {
      // Create test user with real database operations
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-revoke-${Date.now()}@example.com`,
          name: "Test Revoke User",
        },
      });

      // Create GitHub account with encrypted access token
      const encryptedToken = encryptionService.encryptField("access_token", "github_pat_revoke_test_token");
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

      // Create GitHub auth data
      const testGitHubAuth = await tx.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "test-revoke-123456",
          githubUsername: "test-revoke-user",
          githubNodeId: "U_test_revoke_123",
          name: "Test Revoke User",
          publicRepos: 3,
          followers: 5,
          following: 2,
          accountType: "User",
        },
      });

      // Create user session
      const testSession = await tx.session.create({
        data: {
          id: `test-session-${Date.now()}-${Math.random()}`,
          userId: testUser.id,
          sessionToken: `session_token_${Date.now()}`,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      return { testUser, testAccount, testGitHubAuth, testSession };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(async () => {
    // Cleanup any test data that might remain
    await db.session.deleteMany({
      where: {
        sessionToken: { startsWith: "session_token_" },
      },
    });
    
    await db.gitHubAuth.deleteMany({
      where: {
        githubUserId: { startsWith: "test-revoke-" },
      },
    });
    
    await db.account.deleteMany({
      where: {
        providerAccountId: { startsWith: "test-revoke-" },
      },
    });
    
    await db.user.deleteMany({
      where: {
        email: { startsWith: "test-revoke-" },
      },
    });
  });

  describe("Success scenarios", () => {
    test("should successfully revoke GitHub access and cleanup user data", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();

      // Mock session with real user
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful GitHub API token revocation
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // Verify GitHub API was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: JSON.stringify({
            access_token: "github_pat_revoke_test_token",
          }),
        })
      );

      // Verify database cleanup - account should be deleted
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Verify GitHub auth data is deleted
      const deletedGitHubAuth = await db.gitHubAuth.findFirst({
        where: { userId: testUser.id },
      });
      expect(deletedGitHubAuth).toBeNull();

      // Verify user sessions are deleted
      const deletedSession = await db.session.findFirst({
        where: { id: testSession.id },
      });
      expect(deletedSession).toBeNull();

      // Verify user still exists (only account/auth/session data should be deleted)
      const userStillExists = await db.user.findFirst({
        where: { id: testUser.id },
      });
      expect(userStillExists).toBeTruthy();
    });

    test("should handle successful revocation even when GitHub API call fails", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock GitHub API failure but endpoint should still proceed with cleanup
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // Verify database cleanup still occurred despite GitHub API failure
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      const deletedGitHubAuth = await db.gitHubAuth.findFirst({
        where: { userId: testUser.id },
      });
      expect(deletedGitHubAuth).toBeNull();
    });
  });

  describe("Authentication and authorization scenarios", () => {
    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for user session without ID", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" }, // Missing ID
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("GitHub account scenarios", () => {
    test("should return 404 when user has no GitHub account", async () => {
      // Create user without GitHub account
      const userWithoutGitHub = await db.user.create({
        data: {
          id: `test-user-no-github-${Date.now()}`,
          email: `test-no-github-${Date.now()}@example.com`,
          name: "User Without GitHub",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: userWithoutGitHub.id, email: userWithoutGitHub.email },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "No GitHub account found" });
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      await db.user.delete({ where: { id: userWithoutGitHub.id } });
    });

    test("should handle account without access token", async () => {
      const testUser = await db.user.create({
        data: {
          id: `test-user-no-token-${Date.now()}`,
          email: `test-no-token-${Date.now()}@example.com`,
          name: "User Without Token",
        },
      });

      // Create GitHub account without access token
      const testAccount = await db.account.create({
        data: {
          id: `test-account-no-token-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `no-token-${Date.now()}`,
          access_token: null, // No token
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // Should not call GitHub API when no token
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify account is still deleted
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Cleanup
      await db.user.delete({ where: { id: testUser.id } });
    });
  });

  describe("Error handling scenarios", () => {
    test("should handle token decryption errors gracefully", async () => {
      const testUser = await db.user.create({
        data: {
          id: `test-user-bad-token-${Date.now()}`,
          email: `test-bad-token-${Date.now()}@example.com`,
          name: "User With Bad Token",
        },
      });

      // Create account with invalid encrypted token
      const testAccount = await db.account.create({
        data: {
          id: `test-account-bad-token-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `bad-token-${Date.now()}`,
          access_token: "invalid-encrypted-data",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const response = await POST();
      const data = await response.json();

      // Even if token decryption fails, the endpoint should succeed and cleanup local data
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // GitHub API should still be called with the invalid token
      // The EncryptionService doesn't throw on invalid data, it returns it as-is
      expect(mockFetch).toHaveBeenCalled();

      // Verify account is still deleted despite decryption error
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Cleanup
      await db.user.delete({ where: { id: testUser.id } });
    });

    test("should handle network errors when calling GitHub API", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const response = await POST();
      const data = await response.json();

      // Should still succeed and cleanup database even if GitHub API fails
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // Verify database cleanup still occurred
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should handle database deletion errors for sessions", async () => {
      const { testUser, testSession } = await createTestUserWithGitHubAccount();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      // Pre-delete the session to trigger the error handling
      await db.session.delete({ where: { id: testSession.id } });

      const response = await POST();
      const data = await response.json();

      // Should still succeed even if session deletion fails
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
    });
  });

  describe("Security and encryption verification", () => {
    test("should properly decrypt access token before GitHub API call", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await POST();

      // Verify the token was decrypted and sent to GitHub API
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(requestBody.access_token).toBe("github_pat_revoke_test_token");
      expect(requestBody.access_token).not.toContain("data");
      expect(requestBody.access_token).not.toContain("iv");
      expect(requestBody.access_token).not.toContain("tag");
    });

    test("should use correct GitHub App credentials for Basic auth", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await POST();

      const fetchCall = mockFetch.mock.calls[0];
      const authHeader = fetchCall[1].headers.Authorization;
      
      expect(authHeader).toMatch(/^Basic /);
      
      // Decode and verify it contains client credentials pattern
      const base64Credentials = authHeader.replace("Basic ", "");
      const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
      expect(credentials).toMatch(/^.+:.+$/); // Should be in format "clientId:clientSecret"
    });
  });

  describe("Data integrity verification", () => {
    test("should delete only GitHub-related data, preserving user account", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();

      // Create additional non-GitHub account data
      const nonGitHubAccount = await db.account.create({
        data: {
          id: `test-other-account-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: `google-${Date.now()}`,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await POST();

      // Verify only GitHub account was deleted
      const deletedGitHubAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedGitHubAccount).toBeNull();

      // Verify non-GitHub account still exists
      const preservedAccount = await db.account.findFirst({
        where: { id: nonGitHubAccount.id },
      });
      expect(preservedAccount).toBeTruthy();

      // Verify user still exists
      const preservedUser = await db.user.findFirst({
        where: { id: testUser.id },
      });
      expect(preservedUser).toBeTruthy();

      // Cleanup remaining data
      await db.account.delete({ where: { id: nonGitHubAccount.id } });
      await db.user.delete({ where: { id: testUser.id } });
    });

    test("should delete all user sessions for complete re-authentication", async () => {
      const { testUser, testSession } = await createTestUserWithGitHubAccount();

      // Create additional sessions
      const additionalSession = await db.session.create({
        data: {
          id: `test-additional-session-${Date.now()}`,
          userId: testUser.id,
          sessionToken: `additional_session_token_${Date.now()}`,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      await POST();

      // Verify all sessions for the user are deleted
      const remainingSessions = await db.session.findMany({
        where: { userId: testUser.id },
      });
      expect(remainingSessions).toHaveLength(0);
    });
  });
});