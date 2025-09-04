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
global.fetch = vi.fn();

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("Auth Revoke GitHub API Integration Tests", () => {
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
      const encryptedToken = encryptionService.encryptField("access_token", "github_pat_test_token");
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

      // Create a session for the user
      const testSession = await tx.session.create({
        data: {
          id: `test-session-${Date.now()}-${Math.random()}`,
          userId: testUser.id,
          sessionToken: `session-token-${Date.now()}`,
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        },
      });

      return { testUser, testAccount, testGitHubAuth, testSession };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset fetch mock
    mockFetch.mockReset();
  });

  describe("POST /api/auth/revoke-github", () => {
    test("should successfully revoke GitHub access and clean up data", async () => {
      const { testUser, testAccount, testGitHubAuth, testSession } = await createTestUserWithGitHubAccount();
      
      // Mock successful session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful GitHub API revocation
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            Authorization: expect.stringContaining("Basic "),
          }),
          body: expect.stringContaining("github_pat_test_token"),
        })
      );

      // Verify account was deleted from database
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Verify GitHub auth was deleted
      const deletedGitHubAuth = await db.gitHubAuth.findFirst({
        where: { userId: testUser.id },
      });
      expect(deletedGitHubAuth).toBeNull();

      // Verify session was deleted
      const deletedSession = await db.session.findUnique({
        where: { id: testSession.id },
      });
      expect(deletedSession).toBeNull();
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");

      // Verify no GitHub API calls were made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for user without ID in session", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" }, // Missing ID
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");

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

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("No GitHub account found");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle GitHub API errors gracefully", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock GitHub API failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
      } as Response);

      const response = await POST();
      const data = await response.json();

      // Should still succeed and clean up local data even if GitHub API fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was attempted
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          method: "DELETE",
        })
      );

      // Verify local cleanup still occurred
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();

      const deletedGitHubAuth = await db.gitHubAuth.findFirst({
        where: { userId: testUser.id },
      });
      expect(deletedGitHubAuth).toBeNull();
    });

    test("should handle network errors during GitHub API call", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const response = await POST();
      const data = await response.json();

      // Should still succeed and clean up local data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify local cleanup occurred despite network error
      const deletedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(deletedAccount).toBeNull();
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
      const testAccount = await db.account.create({
        data: {
          id: `test-account-no-token-${Date.now()}`,
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: `${Date.now()}`,
          access_token: null,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify no GitHub API call was made (no token to revoke)
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify account was still deleted
      const deletedAccount = await db.account.findUnique({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });

    test("should properly decrypt access token before making GitHub API call", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was called with decrypted token
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        expect.objectContaining({
          body: expect.stringContaining("github_pat_test_token"),
        })
      );
    });

    test("should handle sessions that are already deleted", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      // Delete sessions before the test
      await db.session.deleteMany({
        where: { userId: testUser.id },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const response = await POST();
      const data = await response.json();

      // Should still succeed even if sessions were already deleted
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should return 500 for unexpected database errors", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock database error by using invalid ID format
      vi.spyOn(db.account, 'findFirst').mockRejectedValue(new Error("Database connection error"));

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to revoke GitHub access");
    });
  });
});