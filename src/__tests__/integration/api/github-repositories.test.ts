import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/repositories/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import axios from "axios";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock axios for GitHub API calls
vi.mock("axios");

// Import serviceConfigs from the correct module
import { serviceConfigs } from "@/config/services";

// Helper to create user with GitHub credentials
async function createTestUserWithGitHubCreds() {
  const testUser = await createTestUser({ name: "Test User" });

  // Create GitHubAuth record
  await db.gitHubAuth.create({
    data: {
      userId: testUser.id,
      githubUserId: "12345",
      githubUsername: "test-user",
    },
  });

  // Create Account with encrypted OAuth token
  const encryptionService = EncryptionService.getInstance();
  const encryptedToken = encryptionService.encryptField(
    "access_token",
    "gho_test_oauth_token_123456"
  );

  await db.account.create({
    data: {
      userId: testUser.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "12345",
      access_token: JSON.stringify(encryptedToken),
      token_type: "bearer",
      scope: "repo,user",
    },
  });

  return {
    testUser,
    accessToken: "gho_test_oauth_token_123456",
  };
}

// Helper to create mock GitHub repository response
function createMockRepository(overrides = {}) {
  return {
    id: 123456,
    name: "test-repo",
    full_name: "test-user/test-repo",
    description: "A test repository",
    private: false,
    fork: false,
    stargazers_count: 42,
    watchers_count: 10,
    language: "TypeScript",
    default_branch: "main",
    updated_at: "2024-01-15T10:30:00Z",
    html_url: "https://github.com/test-user/test-repo",
    clone_url: "https://github.com/test-user/test-repo.git",
    size: 1024,
    open_issues_count: 5,
    topics: ["testing", "typescript"],
    ...overrides,
  };
}

describe("GitHub Repositories API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/repositories", () => {
    describe("Authentication scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        await expectUnauthorized(response);
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user", async () => {
        getMockedSession().mockResolvedValue({
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(401);
        expect(data.error).toBe("Unauthorized");
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 500 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        // The API currently returns 500 when user.id is missing because
        // it tries to access session.user.id without proper validation
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should return 400 when GitHub access token not found", async () => {
        const testUser = await createTestUser({ name: "User Without Token" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(400);
        expect(data.error).toBe("GitHub access token not found");
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 400 when GitHub account exists but token is missing", async () => {
        const testUser = await createTestUser();

        // Create GitHubAuth without Account
        await db.gitHubAuth.create({
          data: {
            userId: testUser.id,
            githubUserId: "12345",
            githubUsername: "test-user",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(400);
        expect(data.error).toBe("GitHub access token not found");
      });
    });

    describe("Success scenarios", () => {
      test("should successfully retrieve user repositories with correct parameters", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepos = [
          createMockRepository({
            id: 1,
            name: "repo-1",
            full_name: "test-user/repo-1",
          }),
          createMockRepository({
            id: 2,
            name: "repo-2",
            full_name: "test-user/repo-2",
          }),
          createMockRepository({
            id: 3,
            name: "repo-3",
            full_name: "test-user/repo-3",
          }),
        ];

        vi.mocked(axios.get).mockResolvedValue({
          data: mockRepos,
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(3);
        expect(data.total_count).toBe(3);
        expect(data.repositories[0]).toMatchObject({
          id: 1,
          name: "repo-1",
          full_name: "test-user/repo-1",
        });

        // Verify axios was called with correct parameters
        expect(axios.get).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/repos`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params: {
              sort: "updated",
              per_page: 100,
              type: "all",
            },
          }
        );
      });

      test("should return properly formatted repository metadata", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepo = createMockRepository({
          id: 123,
          name: "awesome-repo",
          full_name: "test-user/awesome-repo",
          description: "An awesome test repository",
          private: true,
          fork: false,
          stargazers_count: 100,
          watchers_count: 25,
          language: "TypeScript",
          default_branch: "main",
          updated_at: "2024-01-15T10:30:00Z",
          html_url: "https://github.com/test-user/awesome-repo",
          clone_url: "https://github.com/test-user/awesome-repo.git",
          size: 2048,
          open_issues_count: 3,
          topics: ["typescript", "testing", "automation"],
        });

        vi.mocked(axios.get).mockResolvedValue({
          data: [mockRepo],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(1);
        const repo = data.repositories[0];

        // Verify all expected fields are present and correct
        expect(repo).toMatchObject({
          id: 123,
          name: "awesome-repo",
          full_name: "test-user/awesome-repo",
          description: "An awesome test repository",
          private: true,
          fork: false,
          stargazers_count: 100,
          watchers_count: 25,
          language: "TypeScript",
          default_branch: "main",
          updated_at: "2024-01-15T10:30:00Z",
          html_url: "https://github.com/test-user/awesome-repo",
          clone_url: "https://github.com/test-user/awesome-repo.git",
          size: 2048,
          open_issues_count: 3,
          topics: ["typescript", "testing", "automation"],
        });
      });

      test("should handle repositories with missing optional fields", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepo = {
          id: 456,
          name: "minimal-repo",
          full_name: "test-user/minimal-repo",
          private: false,
          fork: false,
          stargazers_count: 0,
          watchers_count: 0,
          default_branch: "main",
          updated_at: "2024-01-15T10:30:00Z",
          html_url: "https://github.com/test-user/minimal-repo",
          clone_url: "https://github.com/test-user/minimal-repo.git",
          size: 0,
          open_issues_count: 0,
          // Missing: description, language, topics
        };

        vi.mocked(axios.get).mockResolvedValue({
          data: [mockRepo],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(1);
        const repo = data.repositories[0];
        expect(repo.id).toBe(456);
        expect(repo.name).toBe("minimal-repo");
        expect(repo.description).toBeUndefined();
        expect(repo.language).toBeUndefined();
        expect(repo.topics).toEqual([]);
      });

      test("should handle empty repository list", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockResolvedValue({
          data: [],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toEqual([]);
        expect(data.total_count).toBe(0);
      });

      test("should handle large repository list (100 repos)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepos = Array.from({ length: 100 }, (_, i) =>
          createMockRepository({
            id: i + 1,
            name: `repo-${i + 1}`,
            full_name: `test-user/repo-${i + 1}`,
          })
        );

        vi.mocked(axios.get).mockResolvedValue({
          data: mockRepos,
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(100);
        expect(data.total_count).toBe(100);
      });

      test("should properly decrypt and use encrypted OAuth token", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockResolvedValue({
          data: [createMockRepository()],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        await expectSuccess(response);

        // Verify the decrypted token was used in authorization header
        expect(axios.get).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "token gho_test_oauth_token_123456",
            }),
          })
        );
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 401 (expired or invalid token)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue({
          response: {
            status: 401,
            statusText: "Unauthorized",
            data: { message: "Bad credentials" },
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(401);
        expect(data.error).toBe("GitHub token expired or invalid");
      });

      test("should handle GitHub API 403 (rate limit exceeded)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue({
          response: {
            status: 403,
            statusText: "Forbidden",
            data: {
              message: "API rate limit exceeded",
              documentation_url:
                "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
            },
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle GitHub API 404 (not found)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue({
          response: {
            status: 404,
            statusText: "Not Found",
            data: { message: "Not Found" },
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue({
          response: {
            status: 500,
            statusText: "Internal Server Error",
            data: { message: "Internal Server Error" },
          },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle network errors", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(new Error("Network error"));

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle timeout errors", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue({
          code: "ECONNABORTED",
          message: "timeout of 5000ms exceeded",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();

        const data = await response.json();
        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });
    });

    describe("Edge cases", () => {
      test("should handle repositories with null or undefined values", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepo = {
          id: 789,
          name: "edge-case-repo",
          full_name: "test-user/edge-case-repo",
          description: null,
          private: false,
          fork: false,
          stargazers_count: 0,
          watchers_count: 0,
          language: null,
          default_branch: "main",
          updated_at: "2024-01-15T10:30:00Z",
          html_url: "https://github.com/test-user/edge-case-repo",
          clone_url: "https://github.com/test-user/edge-case-repo.git",
          size: 0,
          open_issues_count: 0,
          topics: null,
        };

        vi.mocked(axios.get).mockResolvedValue({
          data: [mockRepo],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(1);
        expect(data.repositories[0].topics).toEqual([]);
      });

      test("should handle repositories with empty topics array", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepo = createMockRepository({
          topics: [],
        });

        vi.mocked(axios.get).mockResolvedValue({
          data: [mockRepo],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories[0].topics).toEqual([]);
      });

      test("should handle different repository types (public, private, fork)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepos = [
          createMockRepository({
            id: 1,
            name: "public-repo",
            private: false,
            fork: false,
          }),
          createMockRepository({
            id: 2,
            name: "private-repo",
            private: true,
            fork: false,
          }),
          createMockRepository({
            id: 3,
            name: "forked-repo",
            private: false,
            fork: true,
          }),
        ];

        vi.mocked(axios.get).mockResolvedValue({
          data: mockRepos,
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(3);
        expect(data.repositories[0].private).toBe(false);
        expect(data.repositories[1].private).toBe(true);
        expect(data.repositories[2].fork).toBe(true);
      });

      test("should handle repositories with different default branches", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepos = [
          createMockRepository({
            id: 1,
            name: "main-branch-repo",
            default_branch: "main",
          }),
          createMockRepository({
            id: 2,
            name: "master-branch-repo",
            default_branch: "master",
          }),
          createMockRepository({
            id: 3,
            name: "dev-branch-repo",
            default_branch: "dev",
          }),
        ];

        vi.mocked(axios.get).mockResolvedValue({
          data: mockRepos,
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(3);
        expect(data.repositories[0].default_branch).toBe("main");
        expect(data.repositories[1].default_branch).toBe("master");
        expect(data.repositories[2].default_branch).toBe("dev");
      });
    });

    describe("Response format validation", () => {
      test("should return properly formatted success response", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockResolvedValue({
          data: [createMockRepository()],
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("repositories");
        expect(data).toHaveProperty("total_count");
        expect(Array.isArray(data.repositories)).toBe(true);
        expect(typeof data.total_count).toBe("number");
      });

      test("should match total_count with repositories array length", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockRepos = Array.from({ length: 42 }, (_, i) =>
          createMockRepository({ id: i + 1, name: `repo-${i + 1}` })
        );

        vi.mocked(axios.get).mockResolvedValue({
          data: mockRepos,
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repositories"
        );

        const response = await GET();
        const data = await expectSuccess(response);

        expect(data.repositories).toHaveLength(42);
        expect(data.total_count).toBe(42);
        expect(data.total_count).toBe(data.repositories.length);
      });
    });
  });
});