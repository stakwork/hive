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
  createTestUserWithGitHubTokens,
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
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
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
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

        await expectUnauthorized(response);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
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

      test("should return 400 for invalid repository URL format", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
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

      test("should return 400 for malformed GitHub URL", async () => {
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
        expect(data.message).toBe("Invalid GitHub repository URL");
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
        expect(data.data.repositoryUrl).toBe(testRepositoryUrls.https);
        expect(data.data.githubOwner).toBe("test-owner");
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
        expect(data.data.repositoryUrl).toBe(testRepositoryUrls.httpsWithGit);
      });
    });

    describe("First-time installation scenarios", () => {
      test("should generate installation URL when app not installed", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "new-install-workspace",
        });

        // Create a session record for the user
        await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `test-session-token-${testUser.id}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

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
        expect(data.data.link).toContain("github.com/apps/");
        expect(data.data.link).toContain("installations/new");
        expect(data.data.state).toBeDefined();
        expect(data.data.githubOwner).toBe("test-owner");

        // Verify state token was stored in session
        const session = await db.session.findFirst({
          where: { userId: testUser.id },
        });
        expect(session?.githubState).toBe(data.data.state);
      });

      test("should include state parameter in installation URL", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "state-test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Decode state to verify it contains workspace info
        const stateData = JSON.parse(
          Buffer.from(data.data.state, "base64").toString()
        );

        expect(stateData.workspaceSlug).toBe(workspace.slug);
        expect(stateData.repositoryUrl).toBe(
          "https://github.com/owner/repo"
        );
        expect(stateData.randomState).toBeDefined();
        expect(stateData.timestamp).toBeDefined();
      });

      test("should force user account installation for user repositories", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "user-repo-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/johndoe/personal-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.link).toContain("target_type=User");
        expect(data.data.ownerType).toBeUndefined(); // Not set until API check
      });
    });

    describe("Existing installation detection scenarios", () => {
      test("should detect existing installation from database", async () => {
        const { testUser, sourceControlOrg } =
          await createTestUserWithGitHubTokens({
            githubOwner: "existing-org",
            githubInstallationId: 12345,
            accessToken: "existing_token",
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
            repositoryUrl: "https://github.com/existing-org/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data.flowType).toBe("user_authorization");
        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(12345);
        expect(data.data.link).toContain(
          "github.com/login/oauth/authorize"
        );
        expect(data.data.link).toContain("state=");
      });

      test("should detect installation via GitHub API when DB empty", async () => {
        const { testUser, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "other-org",
            githubInstallationId: 99999,
            accessToken: "test_token",
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "api-check-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API to return user type
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 12345,
            login: "test-user",
            type: "Organization",
          }),
        });

        // Mock GitHub API to return installation
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 54321,
            account: {
              login: "test-user",
            },
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test-user/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(true);
        expect(data.data.installationId).toBe(54321);
        expect(data.data.flowType).toBe("user_authorization");
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      test("should handle user account type detection via API", async () => {
        const { testUser, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "personal-user",
            githubInstallationId: 11111,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "user-type-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API to return User type
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 67890,
            login: "personal-user",
            type: "User",
          }),
        });

        // Mock GitHub API to return user installation
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 11111,
            account: {
              login: "personal-user",
            },
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/personal-user/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.ownerType).toBe("user");
        expect(data.data.appInstalled).toBe(true);
      });

      test("should fallback to installation flow when API check fails", async () => {
        const { testUser, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "failed-check",
            githubInstallationId: 22222,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "api-fail-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API to return 404 (no installation)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 99999,
            login: "failed-check",
            type: "Organization",
          }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/failed-check/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.appInstalled).toBe(false);
        expect(data.data.flowType).toBe("installation");
        expect(data.data.link).toContain("installations/new");
      });
    });

    describe("State token management", () => {
      test("should generate unique state tokens for each request", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "unique-state-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request1 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/owner1/repo1",
          }
        );

        const request2 = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/owner2/repo2",
          }
        );

        const response1 = await POST(request1);
        const data1 = await expectSuccess(response1);

        const response2 = await POST(request2);
        const data2 = await expectSuccess(response2);

        expect(data1.data.state).not.toBe(data2.data.state);

        const stateData1 = JSON.parse(
          Buffer.from(data1.data.state, "base64").toString()
        );
        const stateData2 = JSON.parse(
          Buffer.from(data2.data.state, "base64").toString()
        );

        expect(stateData1.randomState).not.toBe(stateData2.randomState);
      });

      test("should store state token in user session", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "session-state-workspace",
        });

        // Create a session record for the user
        await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `test-session-token-${testUser.id}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Verify state was stored in session
        const session = await db.session.findFirst({
          where: { userId: testUser.id },
        });

        expect(session?.githubState).toBe(data.data.state);
      });
    });

    describe("Error handling scenarios", () => {
      test("should return 500 when GITHUB_APP_SLUG is not configured", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Temporarily unset GITHUB_APP_SLUG
        const originalSlug = process.env.GITHUB_APP_SLUG;
        delete process.env.GITHUB_APP_SLUG;

        // Force config to re-evaluate
        vi.resetModules();
        const { POST: PostWithoutConfig } = await import(
          "@/app/api/github/app/install/route"
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await PostWithoutConfig(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("GitHub App not configured");

        // Restore GITHUB_APP_SLUG
        process.env.GITHUB_APP_SLUG = originalSlug;
      });

      test("should handle database errors gracefully", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Create request with workspace that will fail DB query
        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: "test-workspace",
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        // Mock db.workspace.findUnique to throw error
        vi.spyOn(db.workspace, "findUnique").mockRejectedValueOnce(
          new Error("Database connection failed")
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Failed to generate GitHub link");
      });

      test("should handle GitHub API network errors", async () => {
        const { testUser, accessToken } =
          await createTestUserWithGitHubTokens({
            githubOwner: "network-error",
            githubInstallationId: 33333,
          });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "network-error-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API to throw network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/network-error/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        // Should fallback to installation flow on API error
        expect(data.data.appInstalled).toBe(false);
        expect(data.data.flowType).toBe("installation");
      });
    });

    describe("Response structure validation", () => {
      test("should return correct response structure for installation flow", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "response-test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data).toMatchObject({
          success: true,
          data: {
            link: expect.stringContaining("github.com"),
            state: expect.any(String),
            flowType: expect.stringMatching(/installation|user_authorization/),
            appInstalled: expect.any(Boolean),
            githubOwner: expect.any(String),
            repositoryUrl: expect.any(String),
          },
        });
      });

      test("should include installationId for existing installations", async () => {
        const { testUser } = await createTestUserWithGitHubTokens({
          githubOwner: "installed-org",
          githubInstallationId: 44444,
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "installed-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/installed-org/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.installationId).toBe(44444);
        expect(data.data.appInstalled).toBe(true);
      });
    });
  });
});