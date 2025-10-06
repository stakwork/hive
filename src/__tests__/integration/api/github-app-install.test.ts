import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/install/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createTestWorkspaceWithRepo,
  createTestWorkspaceWithSourceControl,
  createTestUserWithAppTokens,
  mockGitHubInstallationResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-app-installation";
import { db } from "@/lib/db";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Import the mocked function
import { getUserAppTokens } from "@/lib/githubApp";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub App Install API Integration Tests", () => {
  const TEST_GITHUB_APP_SLUG = "test-github-app";

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    
    // Set required environment variables for tests
    process.env.GITHUB_APP_SLUG = TEST_GITHUB_APP_SLUG;
    process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
    
    // Set required environment variables to prevent env.ts from throwing errors
    process.env.STAKWORK_API_KEY = "test-stakwork-key";
    process.env.POOL_MANAGER_API_KEY = "test-pool-key";
    process.env.POOL_MANAGER_API_USERNAME = "test-user";
    process.env.POOL_MANAGER_API_PASSWORD = "test-pass";
    process.env.SWARM_SUPERADMIN_API_KEY = "test-swarm-key";
    process.env.SWARM_SUPER_ADMIN_URL = "https://test-swarm.com";
    process.env.STAKWORK_CUSTOMERS_EMAIL = "test@example.com";
    process.env.STAKWORK_CUSTOMERS_PASSWORD = "test-password";
  });

  describe("POST /api/github/app/install", () => {
    describe("Session authentication", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);

        await expectUnauthorized(response);
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Unauthorized");
      });
    });

    describe("Input validation", () => {
      test("should return 400 for missing workspaceSlug", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {}
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Workspace slug is required");
      });

      test("should return 404 for non-existent workspace", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "non-existent-workspace",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Workspace not found");
      });

      test("should return 400 when workspace has no repository URL", async () => {
        const testUser = await createTestUser();

        // Create workspace without swarm/repository
        const workspace = await db.workspace.create({
          data: {
            name: "No Repo Workspace",
            slug: "no-repo-workspace",
            description: "Workspace without repository",
            ownerId: testUser.id,
          },
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

      test("should return 400 for invalid GitHub repository URL", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.invalid, // GitLab URL
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
        expect(data.message).toBe("Invalid GitHub repository URL");
      });
    });

    describe("CSRF state token generation", () => {
      test("should generate and store state token in user session", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
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
        const data = await expectSuccess(response);

        expect(data.data.state).toBeDefined();
        expect(typeof data.data.state).toBe("string");

        // Verify state is base64 encoded
        const decodedState = JSON.parse(
          Buffer.from(data.data.state, "base64").toString()
        );
        expect(decodedState.workspaceSlug).toBe(workspace.slug);
        expect(decodedState.timestamp).toBeDefined();
        expect(decodedState.randomState).toBeDefined();

        // Verify state was stored in session
        const session = await db.session.findFirst({
          where: { userId: testUser.id },
        });
        expect(session?.githubState).toBe(data.data.state);
      });

      test("should include repositoryUrl in state when provided", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.https,
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
        const data = await expectSuccess(response);

        const decodedState = JSON.parse(
          Buffer.from(data.data.state, "base64").toString()
        );
        expect(decodedState.repositoryUrl).toBe(testRepositoryUrls.https);
      });
    });

    describe("Installation detection - Database layer", () => {
      test("should detect existing installation from database", async () => {
        const testUser = await createTestUser();
        const githubOwner = "existing-org";
        const installationId = 987654321;

        const { workspace } = await createTestWorkspaceWithSourceControl({
          ownerId: testUser.id,
          githubLogin: githubOwner,
          githubInstallationId: installationId,
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
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(installationId);
        expect(data.data.flowType).toBe("user_authorization");
        expect(data.data.githubOwner).toBe(githubOwner);
        expect(data.data.link).toContain("github.com/login/oauth/authorize");
      });

      test("should handle workspace without source control org", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          githubOwner: "new-org",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(false);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.link).toContain(
          `github.com/apps/${TEST_GITHUB_APP_SLUG}/installations/new`
        );
      });
    });

    describe("Installation detection - GitHub API fallback", () => {
      test("should check GitHub API when user has tokens", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";
        const installationId = 123456789;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          githubOwner,
        });

        // User has app tokens but no SourceControlOrg in database
        const { accessToken } = await createTestUserWithAppTokens({
          githubOwner: "different-org",
          githubInstallationId: 999999,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API responses
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.checkOwnerTypeOrg(githubOwner)
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.orgInstallationSuccess(installationId)
          );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(installationId);
        expect(data.data.flowType).toBe("user_authorization");

        // Verify GitHub API was called
        expect(mockFetch).toHaveBeenCalledWith(
          `https://api.github.com/users/${githubOwner}`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${accessToken}`,
            }),
          })
        );
      });

      test("should detect user type and check user installation endpoint", async () => {
        const testUser = await createTestUser();
        const githubOwner = "testuser";
        const installationId = 111222333;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          githubOwner,
        });

        const { accessToken } = await createTestUserWithAppTokens({
          githubOwner: "other-user",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API responses for user type
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.checkOwnerTypeUser(githubOwner)
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInstallationSuccess(installationId)
          );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(true);
        expect(data.data.ownerType).toBe("user");
        expect(data.data.flowType).toBe("user_authorization");

        // Verify user installation endpoint was called
        expect(mockFetch).toHaveBeenCalledWith(
          `https://api.github.com/users/${githubOwner}/installation`,
          expect.any(Object)
        );
      });

      test("should handle GitHub API 404 for no installation", async () => {
        const testUser = await createTestUser();
        const githubOwner = "uninstalled-org";

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          githubOwner,
        });

        const { accessToken } = await createTestUserWithAppTokens({
          githubOwner: "other-org",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API responses
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.checkOwnerTypeOrg(githubOwner)
          )
          .mockResolvedValueOnce(mockGitHubInstallationResponses.noInstallation);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(false);
        expect(data.data.flowType).toBe("installation");
      });
    });

    describe("GitHub owner extraction", () => {
      test("should extract owner from HTTPS repository URL", async () => {
        const testUser = await createTestUser();
        const githubOwner = "octocat";

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.httpsOctocat,
          githubOwner,
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
        const data = await expectSuccess(response);

        expect(data.data.githubOwner).toBe(githubOwner);
      });

      test("should extract owner from SSH repository URL", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-owner";

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.ssh,
          githubOwner,
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
        const data = await expectSuccess(response);

        expect(data.data.githubOwner).toBe(githubOwner);
      });

      test("should extract owner from URL with .git suffix", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-owner";

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.httpsWithGit,
          githubOwner,
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
        const data = await expectSuccess(response);

        expect(data.data.githubOwner).toBe(githubOwner);
      });
    });

    describe("Flow type determination", () => {
      test("should return installation flow for user repos with target_type parameter", async () => {
        const testUser = await createTestUser();
        const githubOwner = "testuser";

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.httpsUser,
          githubOwner,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.flowType).toBe("installation");
        expect(data.data.ownerType).toBe("user");
        expect(data.data.link).toContain("target_type=User");
      });

      test("should return installation flow for org repos without target_type", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          githubOwner: "test-org",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.flowType).toBe("installation");
        expect(data.data.link).not.toContain("target_type");
      });

      test("should return user_authorization flow when app already installed", async () => {
        const testUser = await createTestUser();
        const githubOwner = "installed-org";

        const { workspace } = await createTestWorkspaceWithSourceControl({
          ownerId: testUser.id,
          githubLogin: githubOwner,
          githubInstallationId: 123456789,
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
        const data = await expectSuccess(response);

        expect(data.data.flowType).toBe("user_authorization");
        expect(data.data.appInstalled).toBe(true);
        expect(data.data.link).toContain("github.com/login/oauth/authorize");
      });
    });

    describe("Error handling", () => {
      test("should return 500 when GITHUB_APP_SLUG not configured", async () => {
        delete process.env.GITHUB_APP_SLUG;

        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
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

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("GitHub App not configured");
      });

      test("should handle GitHub API network errors gracefully", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const { accessToken } = await createTestUserWithAppTokens({
          githubOwner: "other-org",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Should still return response, but without installation detection
        expect(data.data.appInstalled).toBe(false);
        expect(data.data.flowType).toBe("installation");
      });

      test("should return 500 for unexpected errors", async () => {
        const testUser = await createTestUser();

        // Clear environment variable to trigger config error before database mock
        delete process.env.GITHUB_APP_SLUG;

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("GitHub App not configured");
      });
    });

    describe("Security considerations", () => {
      test("should not expose sensitive data in error responses", async () => {
        const testUser = await createTestUser();

        // Restore environment variable for proper test
        process.env.GITHUB_APP_SLUG = "test-github-app";

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "non-existent-workspace",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.message).toBe("Workspace not found");
        expect(data).not.toHaveProperty("userId");
        expect(data).not.toHaveProperty("stack");
      });

      test("should generate cryptographically random state tokens", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Make two requests
        const request1 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const request2 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
          }
        );

        const response1 = await POST(request1);
        const data1 = await expectSuccess(response1);

        const response2 = await POST(request2);
        const data2 = await expectSuccess(response2);

        // States should be different
        expect(data1.data.state).not.toBe(data2.data.state);

        // Both should decode successfully
        const decoded1 = JSON.parse(
          Buffer.from(data1.data.state, "base64").toString()
        );
        const decoded2 = JSON.parse(
          Buffer.from(data2.data.state, "base64").toString()
        );

        expect(decoded1.randomState).not.toBe(decoded2.randomState);
      });
    });
  });
});