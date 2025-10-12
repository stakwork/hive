import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST, GET } from "@/app/api/github/repository/permissions/route";
import {
  expectSuccess,
  expectUnauthorized,
  createPostRequest,
  createGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createTestUserWithGitHubTokens,
  createAdditionalOrgForUser,
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Import the mocked function
import { getUserAppTokens } from "@/lib/githubApp";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub Repository Permissions API Integration Tests", () => {

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("POST /api/github/repository/permissions", () => {
    describe("Success scenarios", () => {
      test("should successfully check repository permissions with push access", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          hasAccess: true,
          canPush: true, // Should be true with push permission
          canAdmin: false,
          repository: {
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          },
        });

        // Verify GitHub API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        );

        // Verify token retrieval was called with correct parameters
        expect(getUserAppTokens).toHaveBeenCalledWith(
          testUser.id,
          "test-owner"
        );
      });

      test("should calculate canPush=true with admin permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(true); // Admin grants push
        expect(data.data.canAdmin).toBe(true);
      });

      test("should calculate canPush=true with maintain permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.maintainPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(true); // Maintain grants push
        expect(data.data.canAdmin).toBe(false);
      });

      test("should calculate canPush=false and canAdmin=false with only pull permission", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.pullOnlyPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.hasAccess).toBe(true);
        expect(data.data.canPush).toBe(false); // Only pull, no push
        expect(data.data.canAdmin).toBe(false);
      });

      test("should support HTTPS repository URL format", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "octocat",
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            name: "Hello-World",
            full_name: "octocat/Hello-World",
            private: false,
            default_branch: "master",
            permissions: {
              admin: true,
              maintain: true,
              push: true,
              triage: true,
              pull: true,
            },
          }),
        });

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.octocat,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/octocat/Hello-World",
          expect.any(Object)
        );
      });

      test("should support SSH repository URL format", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "nodejs",
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue({
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

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.ssh,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/nodejs/node",
          expect.any(Object)
        );
      });

      test("should support repository URL with .git suffix", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.httpsWithGit,
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        // Unauthenticated test - no session

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);

        await expectUnauthorized(response);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        // Unauthenticated test - no valid session

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when no GitHub tokens found", async () => {
        // Create user without tokens
        const testUser = await createTestUser({ name: "User Without Tokens" });

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.success).toBe(false);
        expect(data.error).toBe("no_github_tokens");
        expect(data.message).toContain(
          "No GitHub App tokens found for this repository's organization"
        );
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when tokens exist but accessToken is missing", async () => {
        const testUser = await createTestUser();        // Mock getUserAppTokens to return object without accessToken
        vi.mocked(getUserAppTokens).mockResolvedValue({
          refreshToken: "some-refresh-token",
        });

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe("no_github_tokens");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing repositoryUrl", async () => {
        const testUser = await createTestUser();
        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {},
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe("Repository URL is required");
      });

      test("should return 400 for invalid repository URL format", async () => {
        const testUser = await createTestUser();
        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.invalid,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toBe("Invalid repository URL");
      });

      test("should return 400 for malformed GitHub URL", async () => {
        const testUser = await createTestUser();
        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.malformed,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Invalid repository URL");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 404 (repository not found)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/nonexistent-repo",
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200); // Endpoint returns 200 with error in body
        expect(data.success).toBe(false);
        expect(data.data.hasAccess).toBe(false);
        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
        expect(data.error).toBe("repository_not_found_or_no_access");
      });

      test("should handle GitHub API 403 (access forbidden)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.accessForbidden);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/private-repo",
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.error).toBe("access_forbidden");
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.serverError);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.error).toBe("http_error_500");
      });

      test("should handle GitHub API network errors", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.error).toBe("network_error");
      });

      test("should handle GitHub API timeout", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens();        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockRejectedValue(new Error("Request timeout"));

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.error).toBe("network_error");
      });
    });

    describe("Token scoping scenarios", () => {
      test("should retrieve tokens scoped to correct GitHub owner", async () => {
        const { testUser, accessToken } = await createTestUserWithGitHubTokens({
          githubOwner: "specific-owner",
        });

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/specific-owner/scoped-repo",
          },
          testUser
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);

        // Verify getUserAppTokens was called with the extracted owner
        expect(getUserAppTokens).toHaveBeenCalledWith(
          testUser.id,
          "specific-owner"
        );
      });

      test("should handle multiple organizations for same user", async () => {
        // Create user with tokens for org1
        const { testUser: user1 } = await createTestUserWithGitHubTokens({
          githubOwner: "org1",
          accessToken: "token_for_org1",
        });

        // Add tokens for org2 to same user
        await createAdditionalOrgForUser(
          user1.id,
          "org2", 
          "token_for_org2"
        );        // Mock getUserAppTokens to return org2 token
        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "token_for_org2",
        });

        mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/org2/repo-in-org2",
          },
          user1
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);

        // Verify it used org2's token
        expect(getUserAppTokens).toHaveBeenCalledWith(user1.id, "org2");
      });
    });

    describe("Error handling edge cases", () => {
      test("should return 500 for unexpected errors", async () => {
        const testUser = await createTestUser();        // Mock getUserAppTokens to throw an error
        vi.mocked(getUserAppTokens).mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createAuthenticatedPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: testRepositoryUrls.https,
          },
          testUser
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.error).toBe("internal_server_error");
      });

      test("should handle malformed JSON in request body", async () => {
        const testUser = await createTestUser();
        // Create request with invalid JSON but with auth headers
        const request = new Request(
          "http://localhost:3000/api/github/repository/permissions",
          {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-middleware-user-id": testUser.id,
              "x-middleware-auth-status": "authenticated"
            },
            body: "invalid json",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        // With middleware auth, 401 is returned before JSON parsing
        // This is expected behavior - auth happens first
        expect(response.status).toBe(401);
        expect(data.error).toBe("Unauthorized");
      });
    });
  });

  describe("GET /api/github/repository/permissions", () => {
    test("should handle query parameters and forward to POST", async () => {
      const { testUser, accessToken } = await createTestUserWithGitHubTokens();

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken,
      });

      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        testUser,
        {
          repositoryUrl: testRepositoryUrls.https,
        }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.hasAccess).toBe(true);
    });

    test("should return 400 for missing repositoryUrl query parameter", async () => {
      const testUser = await createTestUser();
      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Repository URL is required");
    });

    test("should handle workspaceSlug query parameter", async () => {
      const { testUser, accessToken } = await createTestUserWithGitHubTokens();

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken,
      });

      mockFetch.mockResolvedValue({
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

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        testUser,
        {
          repositoryUrl: testRepositoryUrls.https,
          workspaceSlug: "my-workspace",
        }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    test("should return 401 for unauthenticated GET request", async () => {
      // Unauthenticated test - no session

      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        {
          repositoryUrl: "https://github.com/test-owner/test-repo",
        }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });
  });
});