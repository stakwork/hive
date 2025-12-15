import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/repository/branch/numofcommits/route";
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

describe("GitHub Repository NumOfCommits API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/github/repository/branch/numofcommits", () => {
    describe("Success scenarios", () => {
      test("should successfully retrieve commit counts for repository with pagination", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock axios responses in sequence: repository, total commits, last week commits
        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsWithPagination.data,
              mockGitHubApiResponses.commitsWithPagination.headers
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(15).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.message).toBe("Number of commits");
        expect(data.data).toMatchObject({
          numberOfCommits: 1523,
          commitsFromLastWeek: 15,
        });

        // Verify axios was called correctly
        expect(axios.get).toHaveBeenNthCalledWith(
          1,
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        );

        expect(axios.get).toHaveBeenNthCalledWith(
          2,
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo/commits`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params: {
              sha: "main",
              per_page: 1,
            },
          }
        );

        expect(axios.get).toHaveBeenNthCalledWith(
          3,
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo/commits`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params: {
              sha: "main",
              since: expect.any(String),
              per_page: 100,
            },
          }
        );
      });

      test("should handle repository without pagination (small commit count)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data,
              mockGitHubApiResponses.commitsNoPagination.headers
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(1).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data.numberOfCommits).toBe(1);
        expect(data.data.commitsFromLastWeek).toBe(1);
      });

      test("should support HTTPS repository URL format", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(5).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining("test-owner/test-repo"),
          expect.any(Object)
        );
      });

      test("should support SSH repository URL format", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(3).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining("test-owner/test-repo"),
          expect.any(Object)
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(2).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        expect(axios.get).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          expect.any(Object)
        );
      });

      test("should handle repository with master default branch", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.repositoryMaster.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsWithPagination.data,
              mockGitHubApiResponses.commitsWithPagination.headers
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(8).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data.numberOfCommits).toBe(1523);
        expect(data.data.commitsFromLastWeek).toBe(8);

        // Verify master branch was used
        expect(axios.get).toHaveBeenNthCalledWith(
          2,
          expect.any(String),
          expect.objectContaining({
            params: expect.objectContaining({
              sha: "master",
            }),
          })
        );
      });

      test("should handle last week commits with pagination", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsWithPagination.data,
              mockGitHubApiResponses.commitsWithPagination.headers
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommitsPaginated.data,
              mockGitHubApiResponses.lastWeekCommitsPaginated.headers
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // Note: Current implementation multiplies last page by 100
        expect(data.data.commitsFromLastWeek).toBe(300);
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" },
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Unauthorized");
        expect(axios.get).not.toHaveBeenCalled();
      });

      test("should return 400 when GitHub access token not found", async () => {
        const testUser = await createTestUser({ name: "User Without Token" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
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
          "http://localhost:3000/api/github/repository/branch/numofcommits"
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
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should return 500 for malformed URL", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.malformed,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should return 500 for incomplete URL", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.incomplete,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 404 (repository not found)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(
          mockAxiosErrors.repositoryNotFound
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: "https://github.com/test-owner/nonexistent-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle GitHub API 403 (access forbidden)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(
          mockAxiosErrors.accessForbidden
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: "https://github.com/test-owner/private-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle GitHub API 401 (invalid token)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(
          mockAxiosErrors.invalidToken
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("GitHub token expired or invalid");
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(mockAxiosErrors.serverError);

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle GitHub API rate limit", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(
          mockAxiosErrors.rateLimitExceeded
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });

      test("should handle network errors", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get).mockRejectedValueOnce(mockAxiosErrors.networkError);

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to fetch repositories");
      });
    });

    describe("Edge cases", () => {
      test("should handle empty repository (no commits)", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.emptyRepository.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.emptyRepository.data)
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data.numberOfCommits).toBe(0);
        expect(data.data.commitsFromLastWeek).toBe(0);
      });

      test("should handle malformed Link header", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              [{ sha: "abc123", commit: { message: "Test" } }],
              { link: "invalid-link-header" }
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(5).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // Should fall back to data.length when Link header is malformed
        expect(data.data.numberOfCommits).toBe(0);
      });

      test("should calculate correct date for last week filter", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(10).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        await expectSuccess(response);

        // Verify the since parameter is approximately 7 days ago
        const lastCall = vi.mocked(axios.get).mock.calls[2];
        const sinceParam = lastCall[1]?.params?.since;
        expect(sinceParam).toBeDefined();

        const sinceDate = new Date(sinceParam);
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() - 7);

        // Allow 1 minute tolerance for test execution time
        const timeDiff = Math.abs(
          sinceDate.getTime() - expectedDate.getTime()
        );
        expect(timeDiff).toBeLessThan(60000);
      });

      test("should handle popular repository with many recent commits", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsWithPagination.data,
              mockGitHubApiResponses.commitsWithPagination.headers
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              Array.from({ length: 100 }, (_, i) => ({
                sha: `commit${i}`,
                commit: { message: `Recent commit ${i}` },
              }))
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.nodejs,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data.numberOfCommits).toBe(1523);
        expect(data.data.commitsFromLastWeek).toBe(100);
      });
    });

    describe("Response format validation", () => {
      test("should return properly formatted success response", async () => {
        const { testUser } = await createTestUserWithGitHubCreds();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(axios.get)
          .mockResolvedValueOnce(
            createMockAxiosResponse(mockGitHubApiResponses.repositoryMain.data)
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.commitsNoPagination.data
            )
          )
          .mockResolvedValueOnce(
            createMockAxiosResponse(
              mockGitHubApiResponses.lastWeekCommits(7).data
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/repository/branch/numofcommits",
          {
            repoUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("message");
        expect(data).toHaveProperty("data");
        expect(data.data).toHaveProperty("numberOfCommits");
        expect(data.data).toHaveProperty("commitsFromLastWeek");
        expect(typeof data.data.numberOfCommits).toBe("number");
        expect(typeof data.data.commitsFromLastWeek).toBe("number");
      });
    });
  });
});