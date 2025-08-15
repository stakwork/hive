import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/github/users/search/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import axios from "axios";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock axios for GitHub API calls
vi.mock("axios");

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockAxios = axios as vi.Mocked<typeof axios>;

describe("GitHub Users Search API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithGitHubAccount() {
    // Create test user with real database operations
    const testUser = await db.user.create({
      data: {
        id: `test-user-${Date.now()}-${Math.random()}`,
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    // Create GitHub account with encrypted access token
    const encryptedToken = encryptionService.encryptField("access_token", "github_pat_test_token");
    const testAccount = await db.account.create({
      data: {
        id: `test-account-${Date.now()}-${Math.random()}`,
        userId: testUser.id,
        type: "oauth",
        provider: "github",
        providerAccountId: `${Date.now()}`,
        access_token: JSON.stringify(encryptedToken),
      },
    });

    return { testUser, testAccount };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/users/search", () => {
    test("should search GitHub users successfully with real database operations", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();
      
      // Mock session with real user
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock GitHub API response
      const mockGitHubResponse = {
        data: {
          total_count: 2,
          items: [
            {
              id: 1,
              login: "johndoe",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
              html_url: "https://github.com/johndoe",
              type: "User",
              score: 1.0,
            },
            {
              id: 2,
              login: "johnsmith",
              avatar_url: "https://avatars.githubusercontent.com/u/2",
              html_url: "https://github.com/johnsmith",
              type: "User",
              score: 0.8,
            },
          ],
        },
      };

      mockAxios.get.mockResolvedValue(mockGitHubResponse);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(2);
      expect(data.users[0].login).toBe("johndoe");
      expect(data.users[1].login).toBe("johnsmith");
      expect(data.total_count).toBe(2);

      // Verify GitHub API was called with decrypted token
      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.github.com/search/users",
        {
          headers: {
            Authorization: "token github_pat_test_token",
            Accept: "application/vnd.github.v3+json",
          },
          params: {
            q: "john",
            per_page: 10,
          },
        }
      );

      // Verify real database lookup occurred
      const accountInDb = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(accountInDb).toBeTruthy();
      expect(accountInDb?.access_token).toBe(testAccount.access_token);
    });

    test("should return 401 for unauthenticated user", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("should return 400 for missing query parameter", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Search query must be at least 2 characters",
      });
    });

    test("should return 400 for query too short", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=a");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Search query must be at least 2 characters",
      });
    });

    test("should return 400 when GitHub account not found in database", async () => {
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

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "GitHub access token not found",
      });
    });

    test("should return 401 for expired GitHub token", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock GitHub API 401 response
      mockAxios.get.mockRejectedValue({
        response: { status: 401 },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "GitHub token expired or invalid",
      });
    });

    test("should return 500 for other GitHub API errors", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockAxios.get.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=john");
      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to search GitHub users",
      });
    });

    test("should handle empty search results", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockAxios.get.mockResolvedValue({
        data: {
          total_count: 0,
          items: [],
        },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=veryrareusername");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.users).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });

    test("should properly encrypt and decrypt access tokens", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockAxios.get.mockResolvedValue({
        data: { total_count: 0, items: [] },
      });

      const request = new NextRequest("http://localhost:3000/api/github/users/search?q=test");
      await GET(request);

      // Verify the stored token is encrypted
      const storedAccount = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      
      expect(storedAccount?.access_token).toBeDefined();
      expect(storedAccount?.access_token).not.toContain("github_pat_test_token");
      expect(typeof storedAccount?.access_token).toBe("string");

      // Verify axios was called with decrypted token
      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.github.com/search/users",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token github_pat_test_token",
          }),
        })
      );
    });
  });
});