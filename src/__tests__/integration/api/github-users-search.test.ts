import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/users/search/route";
import { db } from "@/lib/db";
import axios from "axios";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestUserWithGitHubAccount } from "@/__tests__/support/fixtures/user";

// Mock axios for GitHub API calls
vi.mock("axios");

const mockAxios = axios as vi.Mocked<typeof axios>;

describe("GitHub Users Search API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/users/search", () => {
    test("should search GitHub users successfully with real database operations", async () => {
      const { testUser, testAccount } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub search API response
      const mockSearchResponse = {
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
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      };

      // Mock GitHub profile API responses for each user
      const mockProfileJohnDoe = {
        data: {
          id: 1,
          login: "johndoe",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
          html_url: "https://github.com/johndoe",
          type: "User",
          name: "John Doe",
          bio: "Software Engineer",
          public_repos: 25,
          followers: 100,
        },
        headers: {
          "x-ratelimit-remaining": "4999",
        },
      };

      const mockProfileJohnSmith = {
        data: {
          id: 2,
          login: "johnsmith",
          avatar_url: "https://avatars.githubusercontent.com/u/2",
          html_url: "https://github.com/johnsmith",
          type: "User",
          name: "John Smith",
          bio: "Developer",
          public_repos: 15,
          followers: 50,
        },
        headers: {
          "x-ratelimit-remaining": "4998",
        },
      };

      // Mock axios.get to return different responses based on URL
      mockAxios.get.mockImplementation((url: string) => {
        if (url === "https://api.github.com/search/users") {
          return Promise.resolve(mockSearchResponse);
        } else if (url === "https://api.github.com/users/johndoe") {
          return Promise.resolve(mockProfileJohnDoe);
        } else if (url === "https://api.github.com/users/johnsmith") {
          return Promise.resolve(mockProfileJohnSmith);
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "john" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.users).toHaveLength(2);
      expect(data.users[0].login).toBe("johndoe");
      expect(data.users[0].name).toBe("John Doe");
      expect(data.users[0].bio).toBe("Software Engineer");
      expect(data.users[0].public_repos).toBe(25);
      expect(data.users[0].followers).toBe(100);
      expect(data.users[1].login).toBe("johnsmith");
      expect(data.users[1].name).toBe("John Smith");
      expect(data.users[1].bio).toBe("Developer");
      expect(data.users[1].public_repos).toBe(15);
      expect(data.users[1].followers).toBe(50);
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

      // Verify profile API calls were made
      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.github.com/users/johndoe",
        {
          headers: {
            Authorization: "token github_pat_test_token",
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.github.com/users/johnsmith",
        {
          headers: {
            Authorization: "token github_pat_test_token",
            Accept: "application/vnd.github.v3+json",
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
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "john" });
      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should return 400 for missing query parameter", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/users/search");
      const response = await GET(request);

      await expectError(response, "Search query must be at least 2 characters", 400);
    });

    test("should return 400 for query too short", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "a" });
      const response = await GET(request);

      await expectError(response, "Search query must be at least 2 characters", 400);
    });

    test("should return 400 when GitHub account not found in database", async () => {
      // Create user without GitHub account
      const userWithoutGitHub = await createTestUser({ name: "No Auth User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(userWithoutGitHub));

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "john" });
      const response = await GET(request);

      await expectError(response, "GitHub access token not found", 400);
    });

    test("should return 401 for expired GitHub token", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API 401 response
      mockAxios.get.mockRejectedValue({
        response: { status: 401 },
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "john" });
      const response = await GET(request);

      await expectError(response, "GitHub token expired or invalid", 401);
    });

    test("should return 500 for other GitHub API errors", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockAxios.get.mockRejectedValue(new Error("Network error"));

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "john" });
      const response = await GET(request);

      await expectError(response, "Failed to search GitHub users", 500);
    });

    test("should handle empty search results", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockAxios.get.mockResolvedValue({
        data: {
          total_count: 0,
          items: [],
        },
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "veryrareusername" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.users).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });

    test("should properly encrypt and decrypt access tokens", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockAxios.get.mockResolvedValue({
        data: { total_count: 0, items: [] },
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "test" });
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

    test("should skip profile fetches when rate limit is low", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock search response with low rate limit
      const mockSearchResponse = {
        data: {
          total_count: 2,
          items: [
            {
              id: 1,
              login: "user1",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
              html_url: "https://github.com/user1",
              type: "User",
              score: 1.0,
            },
            {
              id: 2,
              login: "user2",
              avatar_url: "https://avatars.githubusercontent.com/u/2",
              html_url: "https://github.com/user2",
              type: "User",
              score: 0.8,
            },
          ],
        },
        headers: {
          "x-ratelimit-remaining": "5", // Low rate limit
        },
      };

      mockAxios.get.mockResolvedValue(mockSearchResponse);

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "user" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      // Should return users without enriched data
      expect(data.users).toHaveLength(2);
      expect(data.users[0].login).toBe("user1");
      expect(data.users[0].name).toBeNull();
      expect(data.users[0].bio).toBeNull();
      expect(data.users[0].public_repos).toBe(0);
      expect(data.users[0].followers).toBe(0);

      // Verify only search endpoint was called, not profile endpoints
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.get).toHaveBeenCalledWith(
        "https://api.github.com/search/users",
        expect.any(Object)
      );
    });

    test("should handle rate limit error (429) on search request", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock rate limit error
      mockAxios.get.mockRejectedValue({
        response: { status: 429 },
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "test" });
      const response = await GET(request);

      await expectError(response, "GitHub API rate limit exceeded", 429);
    });

    test("should handle rate limit error (403) on search request", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock rate limit error (secondary rate limit)
      mockAxios.get.mockRejectedValue({
        response: { status: 403 },
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "test" });
      const response = await GET(request);

      await expectError(response, "GitHub API rate limit exceeded", 429);
    });

    test("should fallback to search data when profile fetch fails", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockSearchResponse = {
        data: {
          total_count: 1,
          items: [
            {
              id: 1,
              login: "testuser",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
              html_url: "https://github.com/testuser",
              type: "User",
              score: 1.0,
            },
          ],
        },
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      };

      // Mock search success but profile fetch failure
      mockAxios.get.mockImplementation((url: string) => {
        if (url === "https://api.github.com/search/users") {
          return Promise.resolve(mockSearchResponse);
        } else if (url.includes("/users/testuser")) {
          return Promise.reject(new Error("Profile fetch failed"));
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "testuser" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      // Should return user with search data only
      expect(data.users).toHaveLength(1);
      expect(data.users[0].login).toBe("testuser");
      expect(data.users[0].name).toBeNull();
      expect(data.users[0].bio).toBeNull();
      expect(data.users[0].public_repos).toBe(0);
      expect(data.users[0].followers).toBe(0);
    });

    test("should stop profile fetches when rate limit hit during enrichment", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockSearchResponse = {
        data: {
          total_count: 3,
          items: [
            {
              id: 1,
              login: "user1",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
              html_url: "https://github.com/user1",
              type: "User",
              score: 1.0,
            },
            {
              id: 2,
              login: "user2",
              avatar_url: "https://avatars.githubusercontent.com/u/2",
              html_url: "https://github.com/user2",
              type: "User",
              score: 0.8,
            },
            {
              id: 3,
              login: "user3",
              avatar_url: "https://avatars.githubusercontent.com/u/3",
              html_url: "https://github.com/user3",
              type: "User",
              score: 0.6,
            },
          ],
        },
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      };

      const mockProfile1 = {
        data: {
          id: 1,
          login: "user1",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
          html_url: "https://github.com/user1",
          type: "User",
          name: "User One",
          bio: "First user",
          public_repos: 10,
          followers: 20,
        },
        headers: {
          "x-ratelimit-remaining": "5", // Low rate limit after first profile
        },
      };

      mockAxios.get.mockImplementation((url: string) => {
        if (url === "https://api.github.com/search/users") {
          return Promise.resolve(mockSearchResponse);
        } else if (url === "https://api.github.com/users/user1") {
          return Promise.resolve(mockProfile1);
        }
        // Shouldn't reach here for user2 and user3
        return Promise.reject(new Error(`Unexpected profile fetch for URL: ${url}`));
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "user" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      // Should return all 3 users
      expect(data.users).toHaveLength(3);

      // First user should have enriched data
      expect(data.users[0].login).toBe("user1");
      expect(data.users[0].name).toBe("User One");
      expect(data.users[0].bio).toBe("First user");
      expect(data.users[0].public_repos).toBe(10);
      expect(data.users[0].followers).toBe(20);

      // Remaining users should only have search data
      expect(data.users[1].login).toBe("user2");
      expect(data.users[1].name).toBeNull();
      expect(data.users[1].bio).toBeNull();

      expect(data.users[2].login).toBe("user3");
      expect(data.users[2].name).toBeNull();
      expect(data.users[2].bio).toBeNull();
    });

    test("should handle profile fetch rate limit error (429)", async () => {
      const { testUser } = await createTestUserWithGitHubAccount();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockSearchResponse = {
        data: {
          total_count: 1,
          items: [
            {
              id: 1,
              login: "testuser",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
              html_url: "https://github.com/testuser",
              type: "User",
              score: 1.0,
            },
          ],
        },
        headers: {
          "x-ratelimit-remaining": "5000",
        },
      };

      mockAxios.get.mockImplementation((url: string) => {
        if (url === "https://api.github.com/search/users") {
          return Promise.resolve(mockSearchResponse);
        } else if (url.includes("/users/testuser")) {
          return Promise.reject({
            response: { status: 429 },
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const request = createGetRequest("http://localhost:3000/api/github/users/search", { q: "testuser" });
      const response = await GET(request);
      const data = await expectSuccess(response);

      // Should return user with fallback data
      expect(data.users).toHaveLength(1);
      expect(data.users[0].login).toBe("testuser");
      expect(data.users[0].name).toBeNull();
      expect(data.users[0].bio).toBeNull();
    });
  });
});