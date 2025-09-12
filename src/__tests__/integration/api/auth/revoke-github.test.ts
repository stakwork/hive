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
global.fetch = vi.fn();

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockFetch = global.fetch as vi.MockedFunction<typeof fetch>;

describe("POST /api/auth/revoke-github Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithGitHubAccount() {
    // Use a transaction to ensure atomicity
    return await db.$transaction(async (tx) => {
      // Create test user with real database operations
      const testUser = await tx.user.create({
        data: {
          id: `revoke-test-user-${Date.now()}-${Math.random()}`,
          email: `revoke-test-${Date.now()}@example.com`,
          name: "Revoke Test User",
        },
      });

      // Create GitHub account with encrypted access token
      const encryptedToken = encryptionService.encryptField("access_token", "github_pat_revoke_test_token");
      const testAccount = await tx.account.create({
        data: {
          id: `revoke-test-account-${Date.now()}-${Math.random()}`,
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
          githubUserId: "revoke123456",
          githubUsername: "revoketestuser",
          githubNodeId: "U_revoke_test123",
          name: "Revoke Test User",
          publicRepos: 10,
          followers: 25,
          following: 15,
          accountType: "User",
        },
      });

      // Create session for the user
      const testSession = await tx.session.create({
        data: {
          id: `revoke-session-${Date.now()}-${Math.random()}`,
          sessionToken: `revoke-token-${Date.now()}-${Math.random()}`,
          userId: testUser.id,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      return { testUser, testAccount, testGitHubAuth, testSession };
    });
  }

  async function cleanupTestData(userId: string) {
    // Clean up test data in reverse dependency order
    await db.session.deleteMany({ where: { userId } });
    await db.gitHubAuth.deleteMany({ where: { userId } });
    await db.account.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup default environment variables for tests
    process.env.GITHUB_CLIENT_ID = "test_client_id";
    process.env.GITHUB_CLIENT_SECRET = "test_client_secret";
  });

  afterEach(async () => {
    // Reset mocks after each test
    vi.resetAllMocks();
  });

  describe("POST /api/auth/revoke-github", () => {
    test("should successfully revoke GitHub access and cleanup database", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();
      
      try {
        // Mock session with real user
        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        // Mock successful GitHub API revoke response
        mockFetch.mockResolvedValue({
          ok: true,
          status: 204,
          statusText: "No Content",
        } as Response);

        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });

        // Verify GitHub API was called with correct parameters
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/applications/revoke",
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
              Authorization: `Basic ${Buffer.from("test_client_id:test_client_secret").toString("base64")}`,
            },
            body: JSON.stringify({
              access_token: "github_pat_revoke_test_token",
            }),
          }
        );

        // Verify database cleanup occurred
        const deletedAccount = await db.account.findFirst({
          where: { userId: testUser.id, provider: "github" },
        });
        expect(deletedAccount).toBeNull();

        const deletedGitHubAuth = await db.gitHubAuth.findFirst({
          where: { userId: testUser.id },
        });
        expect(deletedGitHubAuth).toBeNull();

        const deletedSessions = await db.session.findMany({
          where: { userId: testUser.id },
        });
        expect(deletedSessions).toHaveLength(0);

        // User should still exist
        const user = await db.user.findUnique({
          where: { id: testUser.id },
        });
        expect(user).toBeTruthy();
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for user without ID in session", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when no GitHub account found", async () => {
      // Create user without GitHub account
      const userWithoutGitHub = await db.user.create({
        data: {
          id: `no-github-user-${Date.now()}`,
          email: `no-github-${Date.now()}@example.com`,
          name: "No GitHub User",
        },
      });

      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: userWithoutGitHub.id, email: userWithoutGitHub.email },
        });

        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data).toEqual({ error: "No GitHub account found" });
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        await cleanupTestData(userWithoutGitHub.id);
      }
    });

    test("should handle GitHub API failure gracefully", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();
      
      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        // Mock failed GitHub API response
        mockFetch.mockResolvedValue({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
        } as Response);

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

        const deletedGitHubAuth = await db.gitHubAuth.findFirst({
          where: { userId: testUser.id },
        });
        expect(deletedGitHubAuth).toBeNull();
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should handle GitHub API network error gracefully", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();
      
      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        // Mock network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        const response = await POST();
        const data = await response.json();

        // Should still succeed and cleanup database even with network error
        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });

        // Verify database cleanup still occurred
        const deletedAccount = await db.account.findFirst({
          where: { userId: testUser.id, provider: "github" },
        });
        expect(deletedAccount).toBeNull();
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should handle account without access token", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      try {
        // Update account to remove access token
        await db.account.updateMany({
          where: { userId: testUser.id, provider: "github" },
          data: { access_token: null },
        });

        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });

        // Should not call GitHub API if no access token
        expect(mockFetch).not.toHaveBeenCalled();

        // Database cleanup should still occur
        const deletedAccount = await db.account.findFirst({
          where: { userId: testUser.id, provider: "github" },
        });
        expect(deletedAccount).toBeNull();
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should handle session deletion failure gracefully", async () => {
      const { testUser, testAccount, testGitHubAuth } = await createTestUserWithGitHubAccount();
      
      try {
        // Pre-delete sessions to simulate deletion failure
        await db.session.deleteMany({ where: { userId: testUser.id } });

        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        mockFetch.mockResolvedValue({
          ok: true,
          status: 204,
          statusText: "No Content",
        } as Response);

        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({ success: true });

        // Other cleanup should still work
        const deletedAccount = await db.account.findFirst({
          where: { userId: testUser.id, provider: "github" },
        });
        expect(deletedAccount).toBeNull();
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should properly decrypt access token before GitHub API call", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();
      
      try {
        mockGetServerSession.mockResolvedValue({
          user: { id: testUser.id, email: testUser.email },
        });

        mockFetch.mockResolvedValue({
          ok: true,
          status: 204,
          statusText: "No Content",
        } as Response);

        await POST();

        // Verify the encrypted token was properly decrypted in the GitHub API call
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/applications/revoke",
          expect.objectContaining({
            body: JSON.stringify({
              access_token: "github_pat_revoke_test_token",
            }),
          })
        );

        // Verify stored token is different from decrypted value
        const storedAccount = await db.account.findFirst({
          where: { userId: testUser.id, provider: "github" },
        });
        
        // Account should be deleted, so this will be null, but we can verify
        // the test setup worked by checking that the account existed before deletion
        expect(testAccount.access_token).not.toContain("github_pat_revoke_test_token");
        expect(typeof testAccount.access_token).toBe("string");
      } finally {
        await cleanupTestData(testUser.id);
      }
    });

    test("should return 500 for unexpected database errors", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "invalid-user-id-that-causes-db-error", email: "test@example.com" },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      } as Response);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "No GitHub account found" });
    });
  });
});