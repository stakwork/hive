import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/repository/permissions/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import {
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock database for unit tests
vi.mock("@/lib/db", () => ({
  db: {
    user: { create: vi.fn(), findUnique: vi.fn() },
    sourceControlOrg: { create: vi.fn() },
    sourceControlToken: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { getUserAppTokens } from "@/lib/githubApp";

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Unit test helpers - no database dependencies
function createMockUser(options?: { id?: string; email?: string }) {
  return {
    id: options?.id || "test-user-123",
    email: options?.email || "test@example.com",
  };
}

function createMockUserWithTokens(options?: {
  accessToken?: string;
  githubOwner?: string;
  userId?: string;
}) {
  const userId = options?.userId || "test-user-123";
  return {
    testUser: createMockUser({ id: userId }),
    accessToken: options?.accessToken || "github_pat_test_token_123",
  };
}

describe("checkRepositoryPermissions - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("URL Parsing and Validation", () => {
    test("should correctly parse HTTPS GitHub URLs", async () => {
      const { testUser, accessToken } = createMockUserWithTokens({
        githubOwner: "test-owner",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: "https://github.com/test-owner/test-repo" }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should correctly parse SSH GitHub URLs", async () => {
      const { testUser, accessToken } = createMockUserWithTokens({
        githubOwner: "nodejs",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: "git@github.com:nodejs/node.git" }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/nodejs/node",
        expect.any(Object)
      );
    });

    test("should handle URLs with .git suffix", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.httpsWithGit }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should reject non-GitHub URLs", async () => {
      const testUser = createMockUser();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.invalid }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid repository URL");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should reject malformed URLs", async () => {
      const testUser = createMockUser();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.malformed }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid repository URL");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should extract owner correctly from various URL formats", async () => {
      const testCases = [
        { url: "https://github.com/facebook/react", expectedOwner: "facebook" },
        { url: "git@github.com:microsoft/vscode.git", expectedOwner: "microsoft" },
        { url: "https://github.com/vercel/next.js.git", expectedOwner: "vercel" },
      ];

      for (const testCase of testCases) {
        const { testUser, accessToken } = createMockUserWithTokens({
          githubOwner: testCase.expectedOwner,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
        mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          { repositoryUrl: testCase.url }
        );

        await POST(request);

        expect(getUserAppTokens).toHaveBeenCalledWith(
          testUser.id,
          testCase.expectedOwner
        );

        vi.clearAllMocks();
      }
    });
  });

  describe("Permission Calculation Logic", () => {
    test("should grant canPush=true when user has push permission", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(true);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should grant canPush=true when user has admin permission", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(true);
      expect(data.data.canAdmin).toBe(true);
    });

    test("should grant canPush=true when user has maintain permission", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.maintainPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(true);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should deny canPush when user has only pull permission", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pullOnlyPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should correctly set canAdmin only when admin permission exists", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      // Test with admin permission
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      let request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      let response = await POST(request);
      let data = await response.json();

      expect(data.data.canAdmin).toBe(true);

      // Test with maintain permission (should not grant admin)
      mockFetch.mockResolvedValue(mockGitHubApiResponses.maintainPermission);

      request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      response = await POST(request);
      data = await response.json();

      expect(data.data.canAdmin).toBe(false);
    });

    test("should handle permission object with all permission types", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
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
            triage: true,
            pull: true,
          },
        }),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
      expect(data.data.permissions).toEqual({
        admin: false,
        maintain: false,
        push: false,
        triage: true,
        pull: true,
      });
    });
  });

  describe("GitHub API Error Handling", () => {
    test("should handle 404 repository not found", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.data.hasAccess).toBe(false);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
      expect(data.error).toBe("repository_not_found_or_no_access");
    });

    test("should handle 403 access forbidden", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.accessForbidden);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.data.hasAccess).toBe(false);
      expect(data.error).toBe("access_forbidden");
    });

    test("should handle 500 server error", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.serverError);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("http_error_500");
    });

    test("should handle network errors", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("network_error");
    });

    test("should handle different HTTP error codes", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      const errorCodes = [401, 422, 503];

      for (const statusCode of errorCodes) {
        mockFetch.mockResolvedValue({
          ok: false,
          status: statusCode,
          statusText: `Error ${statusCode}`,
          text: async () => `Error ${statusCode}`,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          { repositoryUrl: testRepositoryUrls.https }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(data.success).toBe(false);
        expect(data.error).toBe(`http_error_${statusCode}`);

        vi.clearAllMocks();
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      }
    });
  });

  describe("Response Structure Validation", () => {
    test("should return complete repository data on success", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("hasAccess");
      expect(data.data).toHaveProperty("canPush");
      expect(data.data).toHaveProperty("canAdmin");
      expect(data.data).toHaveProperty("permissions");
      expect(data.data).toHaveProperty("repository");
      expect(data.data.repository).toHaveProperty("name");
      expect(data.data.repository).toHaveProperty("full_name");
      expect(data.data.repository).toHaveProperty("private");
      expect(data.data.repository).toHaveProperty("default_branch");
    });

    test("should return error structure on failure", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data).toHaveProperty("success", false);
      expect(data).toHaveProperty("error");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("hasAccess", false);
      expect(data.data).toHaveProperty("canPush", false);
      expect(data.data).toHaveProperty("canAdmin", false);
    });

    test("should include permissions object in response", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.permissions).toBeDefined();
      expect(data.data.permissions).toHaveProperty("admin");
      expect(data.data.permissions).toHaveProperty("push");
      expect(data.data.permissions).toHaveProperty("pull");
    });

    test("should handle private repository metadata", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.repository.private).toBe(true);
      expect(data.data.repository.name).toBe("test-repo");
      expect(data.data.repository.full_name).toBe("test-owner/test-repo");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty permissions object", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: {},
        }),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should handle missing permissions field", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
        }),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should handle GitHub API returning unexpected response structure", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.hasAccess).toBe(true);
      expect(data.data.canPush).toBe(false);
      expect(data.data.canAdmin).toBe(false);
    });

    test("should handle GitHub API rate limiting (403 with rate limit message)", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "API rate limit exceeded",
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("access_forbidden");
    });

    test("should handle very long repository names", async () => {
      const longName = "a".repeat(100);
      const { testUser, accessToken } = createMockUserWithTokens({
        githubOwner: "test-owner",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: longName,
          full_name: `test-owner/${longName}`,
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: `https://github.com/test-owner/${longName}` }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.repository.name).toBe(longName);
    });

    test("should handle repositories with special characters in names", async () => {
      const specialName = "my-repo.js";
      const { testUser, accessToken } = createMockUserWithTokens({
        githubOwner: "test-owner",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: specialName,
          full_name: `test-owner/${specialName}`,
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: `https://github.com/test-owner/${specialName}` }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.repository.name).toBe(specialName);
    });

    test("should handle timeout errors gracefully", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("network_error");
    });

    test("should handle fetch aborting", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });
      mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("network_error");
    });

    test("should handle GitHub API returning HTML instead of JSON", async () => {
      const { testUser, accessToken } = createMockUserWithTokens();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("network_error");
    });
  });

  describe("Authorization Edge Cases", () => {
    test("should handle null accessToken", async () => {
      const testUser = createMockUser();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: null });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("no_github_tokens");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle empty string accessToken", async () => {
      const testUser = createMockUser();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "" });

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("no_github_tokens");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle undefined getUserAppTokens response", async () => {
      const testUser = createMockUser();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );
      vi.mocked(getUserAppTokens).mockResolvedValue(undefined);

      const request = createPostRequest(
        "http://localhost:3000/api/github/repository/permissions",
        { repositoryUrl: testRepositoryUrls.https }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("no_github_tokens");
    });
  });
});