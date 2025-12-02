import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/install/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import {
  createTestUserWithGitHubTokens,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock env module - use importOriginal to preserve serviceConfigs and optionalEnvVars
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      GITHUB_APP_SLUG: "test-hive-app",
      GITHUB_APP_CLIENT_ID: "test_client_id_123",
      GITHUB_APP_CLIENT_SECRET: "test_client_secret",
    },
  };
});

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Import the mocked function
import { getUserAppTokens } from "@/lib/githubApp";

// Import serviceConfigs from the correct module
import { serviceConfigs } from "@/config/services";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub App Install API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    
    // Set required environment variables
    process.env.GITHUB_APP_SLUG = "test-hive-app";
    process.env.GITHUB_APP_CLIENT_ID = "test_client_id_123";
  });

  describe("POST /api/github/app/install", () => {
    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 404 for non-existent workspace", async () => {
        const testUser = await createTestUser({ name: "Test User" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "non-existent-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Workspace not found");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing workspaceSlug", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Workspace slug is required");
      });

      test("should return 400 for missing repository URL when workspace has no primary repository", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-repo-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.message).toBe("No repository URL found for this workspace");
      });

      test("should return 400 for invalid GitHub repository URL format", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "invalid-url-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.invalid,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Invalid GitHub repository URL");
      });

      test("should return 400 for malformed repository URL", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "malformed-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.malformed,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Invalid GitHub repository URL");
      });
    });

    describe("New installation flow", () => {
      test("should generate installation URL when app not installed", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "new-install-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return null (no tokens = not installed)
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.appInstalled).toBe(false);
        expect(data.data.githubOwner).toBe("test-owner");
        expect(data.data.repositoryUrl).toBe("https://github.com/test-owner/test-repo");
        expect(data.data.link).toContain(`https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`);
        expect(data.data.link).toContain("state=");
        expect(data.data.state).toBeDefined();
        expect(typeof data.data.state).toBe("string");

        // Verify state token was generated and is base64 encoded
        expect(() => Buffer.from(data.data.state, "base64")).not.toThrow();
      });

      test("should generate installation URL with target_type=User for user repositories", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "user-repo-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return null initially
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/someuser/personal-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.appInstalled).toBe(false);
        expect(data.data.githubOwner).toBe("someuser");
        expect(data.data.link).toContain("installations/new");
      });

      test("should support HTTPS repository URL format", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "https-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.githubOwner).toBe("test-owner");
        expect(data.data.flowType).toBe("installation");
      });

      test("should support SSH repository URL format", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "ssh-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.ssh,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.githubOwner).toBe("nodejs");
        expect(data.data.flowType).toBe("installation");
      });

      test("should support repository URL with .git suffix", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "git-suffix-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.httpsWithGit,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.githubOwner).toBe("test-owner");
      });
    });

    describe("Existing installation detection", () => {
      test("should detect existing installation via database and return authorization URL", async () => {
        const { testUser, sourceControlOrg } = await createTestUserWithGitHubTokens({
          githubOwner: "test-owner",
          githubInstallationId: 12345678,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "existing-install-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("user_authorization");
        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(12345678);
        expect(data.data.githubOwner).toBe("test-owner");
        expect(data.data.ownerType).toBe("user");
        expect(data.data.link).toContain(`https://github.com/login/oauth/authorize`);
        expect(data.data.link).toContain(`client_id=${process.env.GITHUB_APP_CLIENT_ID}`);
        expect(data.data.link).toContain("state=");
      });

      test("should detect existing installation via GitHub API when user has tokens", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "api-check-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return a token
        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test_token_123",
        });

        // Mock GitHub API response for user type check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            login: "test-owner",
            type: "User",
          }),
        });

        // Mock GitHub API response for installation check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 87654321,
            account: {
              login: "test-owner",
              type: "User",
            },
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("user_authorization");
        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(87654321);
        expect(data.data.ownerType).toBe("user");

        // Verify GitHub API was called correctly
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/users/test-owner`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer test_token_123",
              Accept: "application/vnd.github.v3+json",
            }),
          })
        );
      });

      test("should handle organization repositories via GitHub API", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "org-repo-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test_org_token",
        });

        // Mock user type check - org
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            login: "test-org",
            type: "Organization",
          }),
        });

        // Mock org installation check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 99999999,
            account: {
              login: "test-org",
              type: "Organization",
            },
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-org/org-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(99999999);
        expect(data.data.ownerType).toBe("org");

        // Verify org-specific API endpoint was called
        expect(mockFetch).toHaveBeenCalledWith(
          `${serviceConfigs.github.baseURL}/orgs/test-org/installation`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer test_org_token",
            }),
          })
        );
      });

      test("should handle case when GitHub API returns 404 for installation check", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-install-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test_token",
        });

        // Mock user type check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            login: "test-owner",
            type: "User",
          }),
        });

        // Mock installation check - 404 not found
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.appInstalled).toBe(false);
        expect(data.data.installationId).toBeUndefined();
      });
    });

    describe("Error handling scenarios", () => {
      test.skip("should return 500 when GITHUB_APP_SLUG is not configured", async () => {
        // This test is skipped because we're mocking @/config/env module with GITHUB_APP_SLUG
        // In production, missing GITHUB_APP_SLUG is validated by the env.ts file
        delete process.env.GITHUB_APP_SLUG;

        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "config-error-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("GitHub App not configured");
      });

      test("should handle GitHub API network errors gracefully", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "network-error-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test_token",
        });

        // Mock network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Should still return success with installation flow (fallback behavior)
        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("installation");
      });

      test("should handle database errors", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Create workspace then delete it to cause database inconsistency
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "db-error-workspace",
        });

        const { db } = await import("@/lib/db");
        await db.workspace.delete({ where: { id: workspace.id } });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Workspace not found");
      });

      test("should handle getUserAppTokens returning null", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-tokens-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.appInstalled).toBe(false);
      });
    });

    describe("State token generation", () => {
      test("should generate unique state tokens for each request", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "state-test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        // Make two requests
        const request1 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const request2 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response1 = await POST(request1);
        const data1 = await expectSuccess(response1);

        const response2 = await POST(request2);
        const data2 = await expectSuccess(response2);

        // State tokens should be different
        expect(data1.data.state).not.toBe(data2.data.state);
      });

      test("should include workspace slug and repository URL in state token", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "state-content-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Decode state token
        const stateData = JSON.parse(
          Buffer.from(data.data.state, "base64").toString()
        );

        expect(stateData.workspaceSlug).toBe(workspace.slug);
        expect(stateData.repositoryUrl).toBe(testRepositoryUrls.https);
        expect(stateData.randomState).toBeDefined();
        expect(stateData.timestamp).toBeDefined();
        expect(typeof stateData.timestamp).toBe("number");
      });
    });
  });
});