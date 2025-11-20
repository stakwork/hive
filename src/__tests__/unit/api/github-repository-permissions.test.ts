import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock next-auth before importing route handlers
vi.mock("next-auth/next");

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Import after mocks are set up
import { POST, GET } from "@/app/api/github/repository/permissions/route";
import { getServerSession } from "next-auth/next";
import { getUserAppTokens } from "@/lib/githubApp";
import {
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
} from "@/__tests__/support/helpers/api-assertions";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock GitHub API response builders
const createGitHubResponse = (status: number, data?: any) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : status === 403 ? "Forbidden" : "Error",
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const mockGitHubRepo = {
  withPushPermission: () => ({
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
  withAdminPermission: () => ({
    name: "test-repo",
    full_name: "test-owner/test-repo",
    private: true,
    default_branch: "main",
    permissions: {
      admin: true,
      maintain: false,
      push: false,
      triage: false,
      pull: true,
    },
  }),
  withMaintainPermission: () => ({
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
  withPullOnlyPermission: () => ({
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
};

const testUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo",
  sshWithGit: "git@github.com:test-owner/test-repo.git",
  invalidGitLab: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
};

describe("GitHub Repository Permissions API - Unit Tests", () => {
  const mockSession = {
    user: {
      id: "test-user-id",
      email: "test@example.com",
      name: "Test User",
    },
  };

  const mockAccessToken = "gho_test_access_token_123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("POST /api/github/repository/permissions", () => {
    describe("Permission calculation matrix", () => {
      test("should calculate canPush=true and canAdmin=false with push permission", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.hasAccess).toBe(true);
        expect(data.data.canPush).toBe(true);
        expect(data.data.canAdmin).toBe(false);
        expect(data.data.permissions).toEqual({
          admin: false,
          maintain: false,
          push: true,
          triage: false,
          pull: true,
        });
      });

      test("should calculate canPush=true and canAdmin=true with admin permission", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withAdminPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(true); // Admin grants push
        expect(data.data.canAdmin).toBe(true);
      });

      test("should calculate canPush=true and canAdmin=false with maintain permission", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withMaintainPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(true); // Maintain grants push
        expect(data.data.canAdmin).toBe(false);
      });

      test("should calculate canPush=false and canAdmin=false with pull-only permission", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPullOnlyPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.hasAccess).toBe(true);
        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
      });

      test("should handle repository with no permissions field", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        
        const repoWithoutPermissions = {
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          // No permissions field
        };
        
        mockFetch.mockResolvedValue(createGitHubResponse(200, repoWithoutPermissions));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
      });
    });

    describe("URL format parsing", () => {
      test("should parse HTTPS URL without .git suffix", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        await expectSuccess(response);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${mockAccessToken}`,
            }),
          })
        );
      });

      test("should parse HTTPS URL with .git suffix", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.httpsWithGit }),
        });

        const response = await POST(request);
        await expectSuccess(response);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.any(Object)
        );
      });

      test("should parse SSH URL without .git suffix", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.ssh }),
        });

        const response = await POST(request);
        await expectSuccess(response);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.any(Object)
        );
      });

      test("should parse SSH URL with .git suffix", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.sshWithGit }),
        });

        const response = await POST(request);
        await expectSuccess(response);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.any(Object)
        );
      });

      test("should reject non-GitHub URL", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.invalidGitLab }),
        });

        const response = await POST(request);

        await expectError(response, "Invalid repository URL", 400);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should reject malformed URL", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.malformed }),
        });

        const response = await POST(request);

        await expectError(response, "Invalid repository URL", 400);
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("Authentication and authorization", () => {
      test("should return 401 when session is null", async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectUnauthorized(response);
        expect(getUserAppTokens).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 when session.user is undefined", async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: undefined });

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectUnauthorized(response);
      });

      test("should return 401 when session.user.id is missing", async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { email: "test@example.com" },
        });

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectUnauthorized(response);
      });

      test("should return 403 when getUserAppTokens returns null", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectForbidden(response, "no_github_tokens");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when getUserAppTokens returns object without accessToken", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ refreshToken: "some-refresh-token" });

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectForbidden(response);
      });

      test("should extract correct GitHub owner and call getUserAppTokens with it", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: "https://github.com/octocat/Hello-World" }),
        });

        await POST(request);

        expect(getUserAppTokens).toHaveBeenCalledWith("test-user-id", "octocat");
      });
    });

    describe("GitHub API error handling", () => {
      test("should handle 404 repository not found", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(404));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(false);
        expect(data.data.hasAccess).toBe(false);
        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
        expect(data.error).toBe("repository_not_found_or_no_access");
      });

      test("should handle 403 access forbidden", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(403));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(false);
        expect(data.error).toBe("access_forbidden");
      });

      test("should handle 500 server error", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(500));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(false);
        expect(data.error).toBe("http_error_500");
      });

      test("should handle network errors", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(false);
        expect(data.error).toBe("network_error");
      });

      test("should handle fetch timeout", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockRejectedValue(new Error("Request timeout"));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.error).toBe("network_error");
      });
    });

    describe("Input validation", () => {
      test("should return 400 when repositoryUrl is missing", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({}),
        });

        const response = await POST(request);

        await expectError(response, "Repository URL is required", 400);
      });

      test("should return 400 when repositoryUrl is empty string", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: "" }),
        });

        const response = await POST(request);

        await expectError(response, "Repository URL is required", 400);
      });

      test("should handle workspaceSlug parameter without errors", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({
            repositoryUrl: testUrls.https,
            workspaceSlug: "my-workspace",
          }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      });
    });

    describe("Error handling edge cases", () => {
      test("should return 500 when getUserAppTokens throws error", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockRejectedValue(new Error("Database connection failed"));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectError(response, "internal_server_error", 500);
      });

      test("should return 500 when request body parsing fails", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);

        // Create request with invalid JSON
        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json",
        });

        const response = await POST(request);

        await expectError(response, "internal_server_error", 500);
      });

      test("should return 500 when getServerSession throws error", async () => {
        vi.mocked(getServerSession).mockRejectedValue(new Error("Session error"));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);

        await expectError(response, "internal_server_error", 500);
      });
    });

    describe("Response structure validation", () => {
      test("should return complete repository data structure", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data).toMatchObject({
          success: true,
          data: {
            hasAccess: expect.any(Boolean),
            canPush: expect.any(Boolean),
            canAdmin: expect.any(Boolean),
            permissions: expect.any(Object),
            repository: {
              name: expect.any(String),
              full_name: expect.any(String),
              private: expect.any(Boolean),
              default_branch: expect.any(String),
            },
          },
        });
      });

      test("should return error structure on failure", async () => {
        vi.mocked(getServerSession).mockResolvedValue(mockSession);
        vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
        mockFetch.mockResolvedValue(createGitHubResponse(404));

        const request = new NextRequest("http://localhost:3000/api/github/repository/permissions", {
          method: "POST",
          body: JSON.stringify({ repositoryUrl: testUrls.https }),
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data).toMatchObject({
          success: false,
          data: {
            hasAccess: false,
            canPush: false,
            canAdmin: false,
          },
          error: expect.any(String),
        });
      });
    });
  });

  describe("GET /api/github/repository/permissions", () => {
    test("should extract repositoryUrl from query parameters and forward to POST", async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession);
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
      mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

      const request = new NextRequest(
        `http://localhost:3000/api/github/repository/permissions?repositoryUrl=${encodeURIComponent(testUrls.https)}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.hasAccess).toBe(true);
    });

    test("should extract workspaceSlug from query parameters", async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession);
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
      mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withPushPermission()));

      const request = new NextRequest(
        `http://localhost:3000/api/github/repository/permissions?repositoryUrl=${encodeURIComponent(testUrls.https)}&workspaceSlug=test-workspace`
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    test("should return 400 when repositoryUrl query parameter is missing", async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/github/repository/permissions");

      const response = await GET(request);

      await expectError(response, "Repository URL is required", 400);
    });

    test("should return 401 when session is missing for GET request", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/github/repository/permissions?repositoryUrl=${encodeURIComponent(testUrls.https)}`
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should handle all permission scenarios via GET endpoint", async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession);
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
      mockFetch.mockResolvedValue(createGitHubResponse(200, mockGitHubRepo.withAdminPermission()));

      const request = new NextRequest(
        `http://localhost:3000/api/github/repository/permissions?repositoryUrl=${encodeURIComponent(testUrls.https)}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.data.canPush).toBe(true);
      expect(data.data.canAdmin).toBe(true);
    });

    test("should handle GitHub API errors via GET endpoint", async () => {
      vi.mocked(getServerSession).mockResolvedValue(mockSession);
      vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: mockAccessToken });
      mockFetch.mockResolvedValue(createGitHubResponse(404));

      const request = new NextRequest(
        `http://localhost:3000/api/github/repository/permissions?repositoryUrl=${encodeURIComponent(testUrls.https)}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(false);
      expect(data.error).toBe("repository_not_found_or_no_access");
    });
  });
});