import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/check/route";
import {
  expectSuccess,
  expectUnauthorized,
  createGetRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createTestUserWithGitHubTokens,
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";

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
      test("should successfully check repository access with push permissions", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock successful repository data fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: true,
              triage: false,
              pull: true,
            },
          }),
        });

        // Mock successful commits fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ sha: "abc123" }],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.canFetchData).toBe(true);
        expect(data.hasPushAccess).toBe(true);
        expect(data.canReadCommits).toBe(true);
        expect(data.repositoryInfo).toMatchObject({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
        });
        expect(data.message).toBe("GitHub App can successfully fetch repository data");

        // Verify GitHub API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            }),
          })
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo/commits?per_page=1",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
            }),
          })
        );

        // Verify token retrieval was called with correct parameters
        expect(getUserAppTokens).toHaveBeenCalledWith(
          testUser.id,
          "test-owner"
        );
      });

      test("should calculate hasPushAccess=true with admin permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "admin-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              admin: true,
              maintain: true,
              push: true,
              triage: true,
              pull: true,
            },
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasPushAccess).toBe(true); // Admin grants push
        expect(data.canReadCommits).toBe(true);
      });

      test("should calculate hasPushAccess=true with maintain permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "maintain-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: true,
              push: false,
              triage: false,
              pull: true,
            },
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ sha: "abc123" }],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.hasPushAccess).toBe(true); // Maintain grants push
      });

      test("should calculate hasPushAccess=false with only pull permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "pull-only-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: false,
              triage: false,
              pull: true,
            },
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ sha: "abc123" }],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.canFetchData).toBe(true);
        expect(data.hasPushAccess).toBe(false); // Only pull, no push
        expect(data.canReadCommits).toBe(true);
      });

      test("should support SSH repository URL format", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "nodejs",
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "ssh-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "node",
            full_name: "nodejs/node",
            private: false,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: true,
              triage: false,
              pull: true,
            },
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ sha: "def456" }],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.canFetchData).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/nodejs/node",
          expect.any(Object)
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "git-suffix-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              push: true,
              pull: true,
            },
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.canFetchData).toBe(true);
      });

      test("should handle canReadCommits=false when commits fetch fails", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-commits-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock successful repository fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions: {
              push: true,
              pull: true,
            },
          }),
        });

        // Mock failed commits fetch
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.canFetchData).toBe(true);
        expect(data.hasPushAccess).toBe(true);
        expect(data.canReadCommits).toBe(false); // Commits fetch failed
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        // Unauthenticated test
        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        // Unauthenticated test - no valid session

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/check",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when workspace access denied", async () => {
        // Create user but no workspace access
        const testUser = await createTestUser({ name: "No Access User" });

        // Create workspace owned by different user
        const otherUser = await createTestUser({ name: "Other User" });
        const workspace = await createTestWorkspace({
          ownerId: otherUser.id,
          slug: "other-workspace",
        });        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Workspace not found or access denied");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 200 with canFetchData=false when no GitHub tokens found", async () => {
        // Create user without tokens
        const testUser = await createTestUser({ name: "User Without Tokens" });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-tokens-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("No GitHub App tokens found for this repository owner");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 200 with canFetchData=false when tokens exist but accessToken is missing", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "missing-access-token",
        });        // Mock getUserAppTokens to return object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("No GitHub App tokens found for this repository owner");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing workspaceSlug", async () => {
        const testUser = await createTestUser();        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Missing required parameter: workspaceSlug");
      });

      test("should return 404 for non-existent workspace", async () => {
        const testUser = await createTestUser();        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: "non-existent-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Workspace not found or access denied");
      });

      test("should return 400 for missing repositoryUrl when workspace has no swarm", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-swarm-workspace",
        });        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            // No repositoryUrl parameter
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("No repository URL provided in parameter or workspace configuration");
      });

      test("should return 400 for invalid repository URL format", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "invalid-url-workspace",
        });        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Invalid GitHub repository URL");
      });

      test("should return 400 for malformed GitHub URL", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "malformed-url-workspace",
        });        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.malformed,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Invalid GitHub repository URL");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 404 (repository not found)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "not-found-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/nonexistent-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200); // Endpoint returns 200 with error in body
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Repository not found or no access");
        expect(data.httpStatus).toBe(404);
      });

      test("should handle GitHub API 403 (access forbidden)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "forbidden-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.accessForbidden);

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/private-repo",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Access forbidden - insufficient permissions");
        expect(data.httpStatus).toBe(403);
      });

      test("should handle GitHub API 401 (authentication failed)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "auth-failed-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "Bad credentials",
        });

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Authentication failed - invalid token");
        expect(data.httpStatus).toBe(401);
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "server-error-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.serverError);

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Failed to fetch repository data");
        expect(data.httpStatus).toBe(500);
      });
    });

    describe("Error handling edge cases", () => {
      test("should return 500 for unexpected errors", async () => {
        const testUser = await createTestUser();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "error-workspace",
        });        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Internal server error during repository check");
      });

      test("should handle GitHub API network errors", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "network-error-workspace",
        });        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createAuthenticatedGetRequest(
          "http://localhost:3000/api/github/app/check",
          testUser,
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.canFetchData).toBe(false);
        expect(data.error).toBe("Internal server error during repository check");
      });
    });
  });
});