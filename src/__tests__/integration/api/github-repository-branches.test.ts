import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/repository/branches/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createTestUserWithGitHubCreds,
  mockGitHubApiResponses,
  mockAxiosErrors,
  testRepositoryUrls,
  createMockAxiosResponse,
} from "@/__tests__/support/factories/github-numofcommits.factory";
import axios from "axios";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock axios
vi.mock("axios");

// Import serviceConfigs from the correct module
import { serviceConfigs } from "@/config/services";

describe("GitHub Repository Branches API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/repository/branches", () => {
    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 500 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 400 when GitHub access token not found", async () => {
        const testUser = await createTestUser({ name: "User Without Token" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("GitHub access token not found");
        expect(axios.get).not.toHaveBeenCalled();
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing repoUrl", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches"
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Repo URL is required");
      });

      test("should return 500 for invalid repository URL format", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });

      test("should return 500 for malformed URL", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.malformed,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });
    });

    describe("Success scenarios", () => {
      test("should successfully retrieve branches with HTTPS repository URL", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
          { name: "develop", commit: { sha: "def456", url: "https://..." } },
          { name: "feature/test", commit: { sha: "ghi789", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(3);
        expect(data.total_count).toBe(3);
        expect(data.branches[0]).toMatchObject({
          name: "main",
          sha: "abc123",
        });
        expect(data.branches[1]).toMatchObject({
          name: "develop",
          sha: "def456",
        });

        // Verify axios was called correctly
        expect(axios.get).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo/branches`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params: {
              per_page: 100,
            },
          }
        );
      });

      test("should support SSH repository URL format", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining("test-owner/test-repo/branches"),
          expect.any(Object)
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        expect(axios.get).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo/branches`,
          expect.any(Object)
        );
      });

      test("should handle repository with many branches", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = Array.from({ length: 50 }, (_, i) => ({
          name: `branch-${i + 1}`,
          commit: { sha: `sha${i + 1}`, url: "https://..." },
        }));

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(50);
        expect(data.total_count).toBe(50);
      });

      test("should properly map branch data from GitHub API response", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          {
            name: "main",
            commit: {
              sha: "abc123def456",
              url: "https://api.github.com/repos/test-owner/test-repo/commits/abc123def456",
            },
            protected: false,
          },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches[0]).toMatchObject({
          name: "main",
          sha: "abc123def456",
        });
      });

      test("should handle request without workspace slug parameter", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(1);
        expect(response.status).toBe(200);
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 404 (repository not found)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(
          mockAxiosErrors.repositoryNotFound
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: "https://github.com/test-owner/nonexistent-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Repository not found");
      });

      test("should handle GitHub API 401 (invalid token)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(mockAxiosErrors.invalidToken);

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("GitHub token expired or invalid");
      });

      test("should handle GitHub API 403 (access forbidden)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(
          mockAxiosErrors.accessForbidden
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: "https://github.com/test-owner/private-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(mockAxiosErrors.serverError);

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });

      test("should handle network errors", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(mockAxiosErrors.networkError);

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });

      test("should handle GitHub API rate limit", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValue(
          mockAxiosErrors.rateLimitExceeded
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch branches");
      });
    });

    describe("Edge cases", () => {
      test("should handle empty repository (no branches)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockResolvedValue(createMockAxiosResponse([]));

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toEqual([]);
        expect(data.total_count).toBe(0);
      });

      test("should handle repository with single branch", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(1);
        expect(data.total_count).toBe(1);
        expect(data.branches[0].name).toBe("main");
      });

      test("should handle branches with different naming conventions", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
          { name: "feature/new-feature", commit: { sha: "def456", url: "https://..." } },
          { name: "bugfix/fix-123", commit: { sha: "ghi789", url: "https://..." } },
          { name: "release/v1.0.0", commit: { sha: "jkl012", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(4);
        expect(data.branches.map((b: any) => b.name)).toEqual([
          "main",
          "feature/new-feature",
          "bugfix/fix-123",
          "release/v1.0.0",
        ]);
      });

      test("should handle branches with long SHA hashes", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const longSha = "a".repeat(40); // 40 character SHA
        const mockBranches = [
          { name: "main", commit: { sha: longSha, url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches[0].sha).toBe(longSha);
        expect(data.branches[0].sha.length).toBe(40);
      });
    });

    describe("Response format validation", () => {
      test("should return properly formatted success response", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("branches");
        expect(data).toHaveProperty("total_count");
        expect(Array.isArray(data.branches)).toBe(true);
        expect(typeof data.total_count).toBe("number");
      });

      test("should match total_count with branches array length", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = Array.from({ length: 15 }, (_, i) => ({
          name: `branch-${i + 1}`,
          commit: { sha: `sha${i + 1}`, url: "https://..." },
        }));

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(15);
        expect(data.total_count).toBe(15);
        expect(data.total_count).toBe(data.branches.length);
      });

      test("should return branches with correct structure", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches[0]).toHaveProperty("name");
        expect(data.branches[0]).toHaveProperty("sha");
        expect(typeof data.branches[0].name).toBe("string");
        expect(typeof data.branches[0].sha).toBe("string");
      });
    });

    describe("Pagination support", () => {
      test("should request branches with per_page parameter", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = [
          { name: "main", commit: { sha: "abc123", url: "https://..." } },
        ];

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        await GET(request);

        expect(axios.get).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            params: {
              per_page: 100,
            },
          })
        );
      });

      test("should handle large number of branches (100+)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const mockBranches = Array.from({ length: 100 }, (_, i) => ({
          name: `branch-${i + 1}`,
          commit: { sha: `sha${i + 1}`, url: "https://..." },
        }));

        vi.mocked(axios.get).mockResolvedValue(
          createMockAxiosResponse(mockBranches)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branches",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.branches).toHaveLength(100);
        expect(data.total_count).toBe(100);
      });
    });
  });
});
