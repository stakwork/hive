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

// Mock githubApp — expose all functions used by the route
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  getPersonalOAuthToken: vi.fn().mockResolvedValue(null),
}));

// Import the mocked functions
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

        // Mock successful direct repo check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            full_name: "test-owner/test-repo",
            permissions: {
              push: true,
              admin: false,
              maintain: false,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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
            full_name: "test-owner/test-repo",
            permissions: {
              admin: true,
              maintain: true,
              push: true,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true); // Admin grants push

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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
            full_name: "test-owner/test-repo",
            permissions: {
              admin: false,
              maintain: true,
              push: false,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true); // Maintain grants push

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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
            full_name: "test-owner/test-repo",
            permissions: {
              admin: false,
              maintain: false,
              push: false,
              pull: true,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false); // Only pull, no push

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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
            full_name: "nodejs/node",
            permissions: {
              push: true,
              admin: false,
              maintain: false,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/nodejs/node`,
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
            full_name: "test-owner/test-repo",
            permissions: {
              push: true,
              pull: true,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(true);

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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

        // Mock 404 response for repository not accessible by installation
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Repository 'test-owner/test-repo' is not accessible through the GitHub App installation.");
        expect(data.requiresInstallationUpdate).toBe(true);
        expect(data.installationId).toBe(sourceControlOrg.githubInstallationId);

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
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
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 200 with app_not_installed when no SourceControlOrg exists", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // No SourceControlOrg for this owner → getUserAppTokens returns null
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        // Use a URL whose owner has no SourceControlOrg in DB
        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: "https://github.com/brand-new-user/my-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("app_not_installed");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 200 with user_not_authorised when SourceControlOrg exists but no user token", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        // Create a second user who has no token for this org
        const secondUser = await createTestUser({ name: "Second User" });
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(secondUser)
        );

        // getUserAppTokens returns null for the second user (no token for this org)
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("user_not_authorised");
        expect(mockFetch).not.toHaveBeenCalled();
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
          {repository_url: testRepositoryUrls.invalid,
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
          {repository_url: testRepositoryUrls.malformed,
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
      test("should return 200 with app_not_installed when no SourceControlOrg found for owner", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // "unknown-owner" has no SourceControlOrg in the DB
        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: "https://github.com/unknown-owner/test-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("app_not_installed");
      });

      test("should handle GitHub API 403 (forbidden access)", async () => {
        const { testUser, sourceControlOrg, accessToken } = await createTestUserWithGitHubTokens();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.hasPushAccess).toBe(false);
        expect(data.error).toBe("GitHub API error 403");
        expect(data.requiresReauth).toBe(true);

        // Verify direct repo API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/repos/test-owner/test-repo`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
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
          {repository_url: testRepositoryUrls.https,
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
        // Need a SourceControlOrg for "test-owner" so the route reaches getUserAppTokens
        const { testUser } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {repository_url: testRepositoryUrls.https,
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
