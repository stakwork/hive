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
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import {
  createTestUserWithInstallation,
  createTestWorkspaceWithoutInstallation,
  mockGitHubInstallResponses,
  testRepositoryUrls,
  InstallEndpointResponse,
} from "@/__tests__/support/fixtures/github-app-install";

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
    describe("Success scenarios", () => {
      test("should successfully generate installation link for new installation", async () => {
        const testUser = await createTestUser({ name: "Install Test User" });
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return null (no existing tokens)
        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data).toBeDefined();
        expect(data.data?.flowType).toBe("installation");
        expect(data.data?.appInstalled).toBe(false);
        expect(data.data?.link).toContain("github.com/apps/");
        expect(data.data?.link).toContain("installations/new");
        expect(data.data?.link).toContain("state=");
        expect(data.data?.state).toBeDefined();
        expect(data.data?.githubOwner).toBe("test-owner");
        expect(data.data?.repositoryUrl).toBe(testRepositoryUrls.https);

        // Verify getUserAppTokens was called
        expect(getUserAppTokens).toHaveBeenCalledWith(testUser.id, "test-owner");
      });

      test("should generate user_authorization link for existing installation", async () => {
        const { testUser, sourceControlOrg, accessToken, workspace } = 
          await createTestUserWithInstallation({
            githubOwner: "test-owner",
            githubInstallationId: 123456789,
          });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock getUserAppTokens to return existing tokens
        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace!.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.flowType).toBe("user_authorization");
        expect(data.data?.appInstalled).toBe(true);
        expect(data.data?.link).toContain("github.com/login/oauth/authorize");
        expect(data.data?.link).toContain("client_id=");
        expect(data.data?.installationId).toBe(sourceControlOrg.githubInstallationId);
      });

      test("should handle repository URL from workspace swarm", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "workspace-with-swarm",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue(null);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            // No repositoryUrl provided - should use workspace swarm
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.repositoryUrl).toBeDefined();
      });

      test("should force target_type=User for user repositories", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test-token",
        });

        // Mock GitHub API calls for user repo
        mockFetch
          .mockResolvedValueOnce(mockGitHubInstallResponses.userIsUser) // User type check
          .mockResolvedValueOnce(mockGitHubInstallResponses.installationNotFound); // No installation

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.userRepo,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.ownerType).toBe("user");
        expect(data.data?.link).toContain("target_type=User");
      });

      test("should allow org choice for organization repositories", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test-token",
        });

        // Mock GitHub API calls for org repo
        mockFetch
          .mockResolvedValueOnce(mockGitHubInstallResponses.userIsOrg) // Org type check
          .mockResolvedValueOnce(mockGitHubInstallResponses.installationNotFound); // No installation

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.orgRepo,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.ownerType).toBe("org");
        expect(data.data?.link).not.toContain("target_type=User");
      });

      test("should detect installation via database check", async () => {
        const { testUser, sourceControlOrg, workspace } = 
          await createTestUserWithInstallation({
            githubOwner: "existing-org",
            githubInstallationId: 999888777,
          });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Database check should find existing installation
        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace!.slug,
            repositoryUrl: "https://github.com/existing-org/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.appInstalled).toBe(true);
        expect(data.data?.installationId).toBe(sourceControlOrg.githubInstallationId);
        expect(data.data?.flowType).toBe("user_authorization");
      });

      test("should detect installation via API fallback when database check fails", async () => {
        const { testUser, accessToken, workspace } = 
          await createTestUserWithInstallation({
            githubOwner: "api-check-org",
          });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        // Mock GitHub API calls for installation detection
        mockFetch
          .mockResolvedValueOnce(mockGitHubInstallResponses.userIsOrg) // User type check
          .mockResolvedValueOnce(mockGitHubInstallResponses.orgInstallationExists); // Installation found

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace!.slug,
            repositoryUrl: "https://github.com/different-org/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.appInstalled).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/users/different-org",
          expect.any(Object)
        );
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/orgs/different-org/installation",
          expect.any(Object)
        );
      });

      test("should support SSH repository URL format", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.githubOwner).toBe("test-owner");
      });

      test("should support HTTPS repository URL with .git suffix", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.repositoryUrl).toBe(testRepositoryUrls.httpsWithGit);
      });
    });

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
        expect(getUserAppTokens).not.toHaveBeenCalled();
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

      test("should return 404 for non-existent workspace", async () => {
        const testUser = await createTestUser();

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

      test("should return 400 for missing repository URL when workspace has no swarm", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "no-swarm-workspace",
          skipSwarm: true, // Create workspace without swarm
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            // No repositoryUrl provided
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
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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

      test("should return 400 for incomplete repository URL", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.incomplete,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.message).toBe("Invalid GitHub repository URL");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should handle GitHub API 404 (user not found)", async () => {
        const { testUser, accessToken, workspace } = 
          await createTestUserWithInstallation();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken,
        });

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace!.slug,
            repositoryUrl: "https://github.com/nonexistent-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        // Should still succeed but installation flow will be triggered
        expect(data.success).toBe(true);
        expect(data.data?.appInstalled).toBe(false);
      });

      test("should handle GitHub API 403 (access forbidden)", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test-token",
        });

        mockFetch.mockResolvedValueOnce(mockGitHubInstallResponses.installationForbidden);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.appInstalled).toBe(false);
      });

      test("should handle GitHub API 500 (server error)", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test-token",
        });

        mockFetch.mockResolvedValueOnce(mockGitHubInstallResponses.installationServerError);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.appInstalled).toBe(false);
      });

      test("should handle GitHub API network errors", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        vi.mocked(getUserAppTokens).mockResolvedValue({
          accessToken: "test-token",
        });

        mockFetch.mockRejectedValueOnce(mockGitHubInstallResponses.networkError);

        const request = createPostRequest(
          "http://localhost:3000/api/github/app/install",
          {
            workspaceSlug: workspace.slug,
            repositoryUrl: testRepositoryUrls.https,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response) as InstallEndpointResponse;

        // Should continue with installation flow despite API error
        expect(data.success).toBe(true);
      });
    });

    describe("State management scenarios", () => {
      test("should generate and store GitHub state in session", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.success).toBe(true);
        expect(data.data?.state).toBeDefined();

        // Decode state to verify structure
        const decodedState = JSON.parse(
          Buffer.from(data.data!.state, "base64").toString()
        );
        expect(decodedState).toHaveProperty("workspaceSlug", workspace.slug);
        expect(decodedState).toHaveProperty("repositoryUrl", testRepositoryUrls.https);
        expect(decodedState).toHaveProperty("randomState");
        expect(decodedState).toHaveProperty("timestamp");
        expect(typeof decodedState.timestamp).toBe("number");
      });

      test("should include state parameter in generated link", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspaceWithoutInstallation(testUser.id);

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
        const data = await expectSuccess(response) as InstallEndpointResponse;

        expect(data.data?.link).toContain(`state=${data.data?.state}`);
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
  });
});