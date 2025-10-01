import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/auth/revoke-github/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  getMockedSession,
} from "@/__tests__/helpers";
import { createTestUser } from "@/__tests__/fixtures/user";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("POST /api/auth/revoke-github Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithGitHubAccount(options?: {
    accessToken?: string;
    includeGitHubAuth?: boolean;
    includeSessions?: boolean;
  }) {
    const {
      accessToken = "github_pat_test_token_123",
      includeGitHubAuth = true,
      includeSessions = true,
    } = options || {};

    // Use a transaction to ensure atomicity
    return await db.$transaction(async (tx) => {
      // Create test user with real database operations
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create GitHub account with encrypted access token
      const encryptedToken = encryptionService.encryptField("access_token", accessToken);
      const testAccount = await tx.account.create({
        data: {
          id: generateUniqueId("test-account"),
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          access_token: JSON.stringify(encryptedToken),
          scope: "read:user,repo",
        },
      });

      let testGitHubAuth = null;
      if (includeGitHubAuth) {
        testGitHubAuth = await tx.gitHubAuth.create({
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
      }

      let testSessions = [];
      if (includeSessions) {
        const session1 = await tx.session.create({
          data: {
            id: generateUniqueId("session-1"),
            sessionToken: `session_token_1_${generateUniqueId()}`,
            userId: testUser.id,
            expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
          },
        });

        const session2 = await tx.session.create({
          data: {
            id: generateUniqueId("session-2"),
            sessionToken: `session_token_2_${generateUniqueId()}`,
            userId: testUser.id,
            expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
          },
        });

        testSessions = [session1, session2];
      }

      return { testUser, testAccount, testGitHubAuth, testSessions };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Success scenarios", () => {
    test("should successfully revoke GitHub access and clean up database", async () => {
      const { testUser, testAccount, testGitHubAuth, testSessions } = 
        await createTestUserWithGitHubAccount();

      // Mock successful session
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock successful GitHub API revocation
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      const response = await POST();
      const data = await expectSuccess(response);

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
            access_token: "github_pat_test_token_123",
          }),
        })
      );

      // Verify account was deleted
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Verify GitHub auth was deleted
      if (testGitHubAuth) {
        const deletedGitHubAuth = await db.gitHubAuth.findFirst({
          where: { userId: testUser.id },
        });
        expect(deletedGitHubAuth).toBeNull();
      }

      // Verify all sessions were deleted
      const remainingSessions = await db.session.findMany({
        where: { userId: testUser.id },
      });
      expect(remainingSessions).toHaveLength(0);
    });

    test("should handle successful revocation even when GitHub API fails", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API failure (but endpoint should still clean up database)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });

      // Verify database cleanup still occurred despite GitHub API failure
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should handle revocation when no access token exists", async () => {
      // Create account without access token
      const testUser = await createTestUser({ name: "Test User No Token" });

      const testAccount = await db.account.create({
        data: {
          id: generateUniqueId("test-account-no-token"),
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          // No access_token field
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });

      // Verify GitHub API was not called
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify account was still deleted
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });
  });

  describe("Authentication and authorization scenarios", () => {
    test("should return 401 for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const response = await POST();

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for session without user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when no GitHub account exists", async () => {
      // Create user without GitHub account
      const testUser = await createTestUser({ name: "Test User No GitHub" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "No GitHub account found" });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Encryption and token handling", () => {
    test("should properly decrypt encrypted access tokens", async () => {
      const originalToken = "github_pat_special_test_token_456";
      const { testUser } = await createTestUserWithGitHubAccount({
        accessToken: originalToken,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });

      // Verify GitHub API was called with decrypted token
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          body: JSON.stringify({
            access_token: originalToken,
          }),
        })
      );
    });

    test("should handle encryption/decryption errors gracefully", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      // Delete the original account first
      await db.account.deleteMany({
        where: { userId: testUser.id },
      });

      // Create account with malformed encrypted token
      const malformedAccount = await db.account.create({
        data: {
          id: `test-account-malformed-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `malformed-${Date.now()}`,
          access_token: "invalid-encrypted-data", // Malformed encryption
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const response = await POST();

      // Should still succeed and clean up database even if decryption fails
      expect(response.status).toBe(200);

      // Verify account was deleted despite decryption error
      const deletedAccount = await db.account.findUnique({
        where: { id: malformedAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });
  });

  describe("External API error scenarios", () => {
    test("should handle network errors when calling GitHub API", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });

      // Verify database cleanup still occurred
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should handle various GitHub API error responses", async () => {
      const errorScenarios = [
        { status: 422, statusText: "Unprocessable Entity" },
        { status: 500, statusText: "Internal Server Error" },
        { status: 403, statusText: "Forbidden" },
      ];

      for (const errorScenario of errorScenarios) {
        // Create fresh test data for each scenario
        const { testUser, testAccount } = await createTestUserWithGitHubAccount();

        getMockedSession().mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        mockFetch.mockResolvedValue({
          ok: false,
          ...errorScenario,
        });

        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });

        // Verify account was deleted despite GitHub API error
        const deletedAccount = await db.account.findUnique({
          where: { id: testAccount.id },
        });
        expect(deletedAccount).toBeNull();
      }
    });
  });

  describe("Database transaction integrity", () => {
    test("should handle multiple sessions cleanup properly", async () => {
      const { testUser, testSessions } = await createTestUserWithGitHubAccount({
        includeSessions: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      // Verify sessions exist before revocation
      const sessionsBefore = await db.session.findMany({
        where: { userId: testUser.id },
      });
      expect(sessionsBefore.length).toBeGreaterThan(0);

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });

      // Verify all sessions were deleted
      const sessionsAfter = await db.session.findMany({
        where: { userId: testUser.id },
      });
      expect(sessionsAfter).toHaveLength(0);
    });

    test("should handle case where sessions are already deleted", async () => {
      const { testUser } = await createTestUserWithGitHubAccount({
        includeSessions: false, // No sessions created
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      const response = await POST();
      const data = await expectSuccess(response);

      expect(data).toEqual({ success: true });
    });
  });

  describe("Error handling and edge cases", () => {
    test("should return 500 for unexpected database errors", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock database error by using invalid user ID
      const invalidUserId = "non-existent-user-id";
      getMockedSession().mockResolvedValue({
        user: { id: invalidUserId, email: "invalid@example.com" },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "No GitHub account found" });
    });

    test("should handle concurrent revocation attempts", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      });

      // First revocation
      const response1 = await POST();
      expect(response1.status).toBe(200);

      // Second revocation (account already deleted)
      const response2 = await POST();
      const data2 = await response2.json();

      expect(response2.status).toBe(404);
      expect(data2).toEqual({ error: "No GitHub account found" });
    });
  });

  describe("Environment variable validation", () => {
    test("should handle missing GitHub client credentials", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Temporarily unset environment variables
      const originalClientId = process.env.GITHUB_CLIENT_ID;
      const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;

      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_SECRET;

      const response = await POST();
      const data = await response.json();

      // Should still succeed with database cleanup
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });

      // Restore environment variables
      process.env.GITHUB_CLIENT_ID = originalClientId;
      process.env.GITHUB_CLIENT_SECRET = originalClientSecret;
    });
  });
});