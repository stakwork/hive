import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/repositories/route";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

// Mock next-auth
vi.mock("next-auth/next");

// Mock getGithubUsernameAndPAT and authOptions
vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn(),
  };
});

// Mock axios to use fetch instead (for global fetch mock compatibility)
vi.mock("axios", async () => {
  const actual = await vi.importActual("axios");
  return {
    ...actual,
    default: {
      get: vi.fn(async (url: string, config: any) => {
        // Build URL with query parameters if provided
        let fullUrl = url;
        if (config?.params) {
          const searchParams = new URLSearchParams(config.params);
          fullUrl = `${url}?${searchParams.toString()}`;
        }
        
        const response = await fetch(fullUrl, {
          method: "GET",
          headers: config?.headers || {},
        });
        
        if (!response.ok) {
          const error: any = new Error("Request failed");
          error.response = { status: response.status };
          throw error;
        }
        
        return {
          data: await response.json(),
        };
      }),
    },
  };
});

describe("GET /api/github/repositories - Integration Tests", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectUnauthorized(response);
      expect(vi.mocked(getGithubUsernameAndPAT)).not.toHaveBeenCalled();
    });

    test("returns 401 when session user is missing", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectUnauthorized(response);
    });
  });

  describe("GitHub Token Validation", () => {
    test("returns 400 when GitHub access token is not found", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      // Mock getGithubUsernameAndPAT to return null (no token)
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "GitHub access token not found", 400);
    });

    test("returns 400 when getGithubUsernameAndPAT returns undefined token", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      // Mock to return object without token
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: undefined as any,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "GitHub access token not found", 400);
    });

    test("returns 401 when GitHub token is expired", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "expired_token",
      });

      // Mock GitHub API to return 401 (expired token)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: "Bad credentials" }),
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "GitHub token expired or invalid", 401);
    });
  });

  describe("GitHub API Failures", () => {
    test("returns 500 when GitHub API network error occurs", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "Failed to fetch repositories", 500);
    });

    test("returns 500 when GitHub API returns 500", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock GitHub API 500 error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal Server Error" }),
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "Failed to fetch repositories", 500);
    });

    test("returns 500 when GitHub API returns 403 (rate limited)", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock GitHub API 403 error (rate limit)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: "API rate limit exceeded" }),
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "Failed to fetch repositories", 500);
    });

    test("handles timeout errors gracefully", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock timeout error
      const timeoutError = new Error("Request timeout");
      (timeoutError as any).code = "ETIMEDOUT";
      mockFetch.mockRejectedValueOnce(timeoutError);

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "Failed to fetch repositories", 500);
    });
  });

  describe("Repository Listing", () => {
    test("returns repositories successfully with valid authentication", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock GitHub API successful response
      const mockRepositories = [
        {
          id: 123456,
          name: "test-repo",
          full_name: "testuser/test-repo",
          description: "A test repository",
          private: false,
          fork: false,
          stargazers_count: 42,
          watchers_count: 10,
          language: "TypeScript",
          default_branch: "main",
          updated_at: "2024-01-15T10:30:00Z",
          html_url: "https://github.com/testuser/test-repo",
          clone_url: "https://github.com/testuser/test-repo.git",
          size: 1024,
          open_issues_count: 3,
          topics: ["testing", "integration"],
        },
        {
          id: 789012,
          name: "another-repo",
          full_name: "testuser/another-repo",
          description: "Another repository",
          private: true,
          fork: true,
          stargazers_count: 5,
          watchers_count: 2,
          language: "JavaScript",
          default_branch: "develop",
          updated_at: "2024-01-14T08:20:00Z",
          html_url: "https://github.com/testuser/another-repo",
          clone_url: "https://github.com/testuser/another-repo.git",
          size: 512,
          open_issues_count: 0,
          topics: [],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepositories,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      expect(data.repositories).toHaveLength(2);
      expect(data.total_count).toBe(2);
      
      // Verify first repository structure
      expect(data.repositories[0]).toMatchObject({
        id: 123456,
        name: "test-repo",
        full_name: "testuser/test-repo",
        description: "A test repository",
        private: false,
        fork: false,
        stargazers_count: 42,
        watchers_count: 10,
        language: "TypeScript",
        default_branch: "main",
        updated_at: "2024-01-15T10:30:00Z",
        html_url: "https://github.com/testuser/test-repo",
        clone_url: "https://github.com/testuser/test-repo.git",
        size: 1024,
        open_issues_count: 3,
        topics: ["testing", "integration"],
      });

      // Verify GitHub API was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://api.github.com/user/repos"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token ghp_test_token",
            Accept: "application/vnd.github.v3+json",
          }),
        })
      );
    });

    test("returns empty array when user has no repositories", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock GitHub API with empty array
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      expect(data.repositories).toEqual([]);
      expect(data.total_count).toBe(0);
    });

    test("handles repositories with null/undefined optional fields", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock repository with null/undefined fields
      const mockRepoWithNulls = [
        {
          id: 999,
          name: "minimal-repo",
          full_name: "testuser/minimal-repo",
          description: null,
          private: false,
          fork: false,
          stargazers_count: 0,
          watchers_count: 0,
          language: null,
          default_branch: "main",
          updated_at: "2024-01-10T12:00:00Z",
          html_url: "https://github.com/testuser/minimal-repo",
          clone_url: "https://github.com/testuser/minimal-repo.git",
          size: 0,
          open_issues_count: 0,
          topics: undefined,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepoWithNulls,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      expect(data.repositories).toHaveLength(1);
      expect(data.repositories[0].description).toBeNull();
      expect(data.repositories[0].language).toBeNull();
      expect(data.repositories[0].topics).toEqual([]);
    });

    test("handles repositories with special characters in names", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      const mockSpecialRepo = [
        {
          id: 555,
          name: "repo-with-special-chars_123",
          full_name: "testuser/repo-with-special-chars_123",
          description: "Test repo with special chars: @#$%",
          private: false,
          fork: false,
          stargazers_count: 0,
          watchers_count: 0,
          language: "C++",
          default_branch: "main",
          updated_at: "2024-01-01T00:00:00Z",
          html_url: "https://github.com/testuser/repo-with-special-chars_123",
          clone_url: "https://github.com/testuser/repo-with-special-chars_123.git",
          size: 256,
          open_issues_count: 0,
          topics: ["c++", "special-chars"],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSpecialRepo,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      expect(data.repositories[0].name).toBe("repo-with-special-chars_123");
      expect(data.repositories[0].description).toBe("Test repo with special chars: @#$%");
    });

    test("verifies GitHub API is called with correct pagination parameters", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      await GET();

      // Verify URL includes pagination parameters
      const fetchCallUrl = mockFetch.mock.calls[0][0];
      expect(fetchCallUrl).toContain("sort=updated");
      expect(fetchCallUrl).toContain("per_page=100");
      expect(fetchCallUrl).toContain("type=all");
    });
  });

  describe("Data Validation", () => {
    test("includes all required repository fields in response", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      const mockRepo = [
        {
          id: 111,
          name: "complete-repo",
          full_name: "testuser/complete-repo",
          description: "Complete repository",
          private: true,
          fork: false,
          stargazers_count: 100,
          watchers_count: 50,
          language: "Python",
          default_branch: "master",
          updated_at: "2024-02-01T15:45:30Z",
          html_url: "https://github.com/testuser/complete-repo",
          clone_url: "https://github.com/testuser/complete-repo.git",
          size: 2048,
          open_issues_count: 15,
          topics: ["python", "data-science"],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepo,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      const repo = data.repositories[0];

      // Verify all 16 mapped fields are present
      expect(repo).toHaveProperty("id");
      expect(repo).toHaveProperty("name");
      expect(repo).toHaveProperty("full_name");
      expect(repo).toHaveProperty("description");
      expect(repo).toHaveProperty("private");
      expect(repo).toHaveProperty("fork");
      expect(repo).toHaveProperty("stargazers_count");
      expect(repo).toHaveProperty("watchers_count");
      expect(repo).toHaveProperty("language");
      expect(repo).toHaveProperty("default_branch");
      expect(repo).toHaveProperty("updated_at");
      expect(repo).toHaveProperty("html_url");
      expect(repo).toHaveProperty("clone_url");
      expect(repo).toHaveProperty("size");
      expect(repo).toHaveProperty("open_issues_count");
      expect(repo).toHaveProperty("topics");
    });

    test("total_count matches repositories array length", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      const mockRepos = Array.from({ length: 5 }, (_, i) => ({
        id: i,
        name: `repo-${i}`,
        full_name: `testuser/repo-${i}`,
        description: `Repository ${i}`,
        private: false,
        fork: false,
        stargazers_count: i * 10,
        watchers_count: i * 5,
        language: "JavaScript",
        default_branch: "main",
        updated_at: "2024-01-01T00:00:00Z",
        html_url: `https://github.com/testuser/repo-${i}`,
        clone_url: `https://github.com/testuser/repo-${i}.git`,
        size: 100 * i,
        open_issues_count: i,
        topics: [],
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepos,
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      const data = await expectSuccess(response, 200);
      expect(data.repositories).toHaveLength(5);
      expect(data.total_count).toBe(5);
      expect(data.total_count).toBe(data.repositories.length);
    });
  });

  describe("Error Edge Cases", () => {
    test("handles malformed JSON response from GitHub API", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock malformed JSON response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      await expectError(response, "Failed to fetch repositories", 500);
    });

    test("handles non-array response from GitHub API", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "ghp_test_token",
      });

      // Mock non-array response (GitHub API should always return array)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Not an array" }),
      });

      const request = createGetRequest("http://localhost/api/github/repositories");
      const response = await GET();

      // Should fail when trying to map over non-array
      await expectError(response, "Failed to fetch repositories", 500);
    });
  });
});
