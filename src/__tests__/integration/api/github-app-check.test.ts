import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/factories/github-permissions.factory";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedSession,
  createGetRequest,
  expectUnauthorized,
  getMockedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { GET } from "@/app/api/github/app/check/route";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Import serviceConfigs from the correct module
import { serviceConfigs } from "@/config/services";

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Import the mocked function
import { getUserAppTokens } from "@/lib/githubApp";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub App Check API Integration Tests", () => {

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("GET /api/github/app/check", () => {
    describe("Success scenarios", () => {
      test("should return hasPushAccess=true when user has push permissions", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock successful installation repositories fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/test-repo",
                permissions: {
                  push: true,
                  admin: false,
                  maintain: false,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );

        // Verify token retrieval was called with correct parameters
        expect(getUserAppTokens).toHaveBeenCalledWith(
          testUser.id,
          "test-owner"
        );
      });

      test("should return hasPushAccess=true with admin permission", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/test-repo",
                permissions: {
                  admin: true,
                  maintain: true,
                  push: true,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true); // Admin grants push

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });

      test("should return hasPushAccess=true with maintain permission", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/test-repo",
                permissions: {
                  admin: false,
                  maintain: true,
                  push: false,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true); // Maintain grants push

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });

      test("should return hasPushAccess=false with only pull permission", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/test-repo",
                permissions: {
                  admin: false,
                  maintain: false,
                  push: false,
                  pull: true,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false); // Only pull, no push

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });

      test("should support SSH repository URL format", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "nodejs",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "nodejs/node",
                permissions: {
                  push: true,
                  admin: false,
                  maintain: false,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.any(Object)
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/test-repo",
                permissions: {
                  push: true,
                  pull: true,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });

      test("should return hasPushAccess=false when repository not accessible through installation", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock installation repositories response without the target repository
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            repositories: [
              {
                full_name: "test-owner/other-repo",
                permissions: {
                  push: true,
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Repository 'test-owner/test-repo' is not accessible through the GitHub App installation. Please ensure the repository is included in the app's permissions or reinstall the app with access to this repository.");

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when no GitHub tokens found", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("No GitHub App tokens found for this repository owner");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when tokens exist but accessToken is missing", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("No GitHub App tokens found for this repository owner");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing repositoryUrl", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {}
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Missing required parameter: repositoryUrl");
      });

      test("should return 400 for invalid repository URL format", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Invalid GitHub repository URL");
      });

      test("should return 400 for malformed GitHub URL", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.malformed,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Invalid GitHub repository URL");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should return 200 with hasPushAccess=false when no installation found", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: "https://github.com/unknown-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("No GitHub App installation found for this repository owner");
      });

      test("should handle GitHub API 404 (installation not found)", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Installation not found or no access to this installation");

        // Verify installation repositories API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/user/installations/${sourceControlOrg.githubInstallationId}/repositories`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );
      });

      test("should handle GitHub API network errors", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Internal server error");
      });
    });

    describe("Error handling edge cases", () => {
      test("should return 500 for unexpected errors", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Internal server error");
      });
    });
  });
});