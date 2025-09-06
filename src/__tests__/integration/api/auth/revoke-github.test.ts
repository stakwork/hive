import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/auth/revoke-github/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock NextAuth - only external dependency
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => {
  const mockEncryptionService = {
    decryptField: vi.fn(),
  };
  return {
    EncryptionService: {
      getInstance: vi.fn(() => mockEncryptionService),
    },
  };
});

// Mock global fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockEncryptionService = EncryptionService.getInstance() as any;

describe("GitHub Revocation API Integration Tests", () => {
  async function createTestUserWithGitHubAccount() {
    return await db.$transaction(async (tx) => {
      // Create the test user
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create GitHub account for the user
      const account = await tx.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "12345",
          access_token: "encrypted_access_token",
          refresh_token: "encrypted_refresh_token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          scope: "read:user user:email",
        },
      });

      // Create GitHub auth data
      const githubAuth = await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: "12345",
          githubUsername: "testuser",
          name: "Test User",
          bio: "Test bio",
          publicRepos: 10,
          followers: 5,
        },
      });

      // Create user sessions
      const session1 = await tx.session.create({
        data: {
          sessionToken: `session-${Date.now()}-1`,
          userId: user.id,
          expires: new Date(Date.now() + 86400000), // 24 hours from now
        },
      });

      const session2 = await tx.session.create({
        data: {
          sessionToken: `session-${Date.now()}-2`,
          userId: user.id,
          expires: new Date(Date.now() + 86400000),
        },
      });

      return { user, account, githubAuth, sessions: [session1, session2] };
    });
  }

  async function createTestUserWithoutGitHubAccount() {
    return await db.user.create({
      data: {
        id: `user-${Date.now()}-${Math.random()}`,
        email: `user-${Date.now()}@example.com`,
        name: "Test User Without GitHub",
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up required environment variables for tests
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    
    // Set up default encryption service mock
    mockEncryptionService.decryptField.mockReturnValue("decrypted_access_token");
    
    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Restore all mocks to prevent test pollution
    vi.restoreAllMocks();
  });

  describe("POST /api/auth/revoke-github - Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");
    });

    test("should return 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
      } as any);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");
    });
  });

  describe("POST /api/auth/revoke-github - GitHub Account Validation", () => {
    test("should return 404 when user has no GitHub account", async () => {
      const user = await createTestUserWithoutGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.error).toBe("No GitHub account found");

      // Verify user still exists in database
      const userInDb = await db.user.findUnique({
        where: { id: user.id },
      });
      expect(userInDb).toBeTruthy();
    });
  });

  describe("POST /api/auth/revoke-github - Successful Revocation", () => {
    test("should successfully revoke GitHub access and clean up database", async () => {
      const { user, account, githubAuth, sessions } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock successful GitHub API response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      } as Response);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify GitHub API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(
              `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
            ).toString("base64")}`,
          },
          body: JSON.stringify({
            access_token: "decrypted_access_token",
          }),
        }
      );

      // Verify encryption service was called to decrypt token
      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "access_token",
        account.access_token
      );

      // Verify account was deleted from database
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();

      // Verify GitHub auth was deleted from database
      const githubAuthInDb = await db.gitHubAuth.findFirst({
        where: { userId: user.id },
      });
      expect(githubAuthInDb).toBeNull();

      // Verify all user sessions were deleted
      const sessionsInDb = await db.session.findMany({
        where: { userId: user.id },
      });
      expect(sessionsInDb).toHaveLength(0);

      // Verify user still exists in database
      const userInDb = await db.user.findUnique({
        where: { id: user.id },
      });
      expect(userInDb).toBeTruthy();
    });

    test("should succeed even if GitHub API revocation fails", async () => {
      const { user, account, githubAuth, sessions } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock failed GitHub API response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify database cleanup still occurred
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();

      const githubAuthInDb = await db.gitHubAuth.findFirst({
        where: { userId: user.id },
      });
      expect(githubAuthInDb).toBeNull();

      const sessionsInDb = await db.session.findMany({
        where: { userId: user.id },
      });
      expect(sessionsInDb).toHaveLength(0);
    });

    test("should succeed even if GitHub API call throws an error", async () => {
      const { user, account, githubAuth } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock GitHub API call throwing an error
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify database cleanup still occurred
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();

      const githubAuthInDb = await db.gitHubAuth.findFirst({
        where: { userId: user.id },
      });
      expect(githubAuthInDb).toBeNull();
    });

    test("should handle account without access token", async () => {
      const { user, account } = await createTestUserWithGitHubAccount();
      
      // Update account to have no access token
      await db.account.update({
        where: { id: account.id },
        data: { access_token: null },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify GitHub API was not called since there's no access token
      expect(mockFetch).not.toHaveBeenCalled();

      // Verify database cleanup still occurred
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();
    });
  });

  describe("POST /api/auth/revoke-github - Session Cleanup Edge Cases", () => {
    test("should handle sessions that are already deleted", async () => {
      const { user, account } = await createTestUserWithGitHubAccount();
      
      // Delete sessions before making the request
      await db.session.deleteMany({
        where: { userId: user.id },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      } as Response);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify account was still deleted
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();
    });
  });

  describe("POST /api/auth/revoke-github - Error Handling", () => {
    test("should return 500 when database operations fail", async () => {
      const { user } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock the database to fail when looking for GitHub account
      // We'll use spyOn to temporarily break the findFirst operation
      const findFirstSpy = vi.spyOn(db.account, 'findFirst').mockRejectedValue(
        new Error("Database connection error")
      );

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.error).toBe("Failed to revoke GitHub access");
      
      // Restore the spy
      findFirstSpy.mockRestore();
    });

    test("should handle multiple GitHub accounts edge case", async () => {
      // Create user with multiple GitHub accounts (edge case)
      const user = await db.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      const account1 = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "12345",
          access_token: "encrypted_access_token_1",
        },
      });

      const account2 = await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "67890",
          access_token: "encrypted_access_token_2",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
      } as Response);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify only the first account found was processed
      // (as per the findFirst logic in the endpoint)
      const remainingAccounts = await db.account.findMany({
        where: { userId: user.id, provider: "github" },
      });
      
      // The endpoint uses findFirst and deletes by ID, so only one account should be deleted
      expect(remainingAccounts).toHaveLength(1);
    });
  });

  describe("POST /api/auth/revoke-github - Environment Variables", () => {
    test("should handle missing GitHub client credentials gracefully", async () => {
      const { user, account } = await createTestUserWithGitHubAccount();
      
      // Remove environment variables
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_SECRET;

      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/auth/revoke-github", {
        method: "POST",
      });

      const response = await POST();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);

      // Verify GitHub API call still attempted (with undefined credentials)
      expect(mockFetch).toHaveBeenCalled();
      
      // Verify database cleanup still occurred
      const accountInDb = await db.account.findUnique({
        where: { id: account.id },
      });
      expect(accountInDb).toBeNull();
    });
  });
});