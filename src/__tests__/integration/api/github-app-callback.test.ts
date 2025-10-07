import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/github/app/callback/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  getMockedSession,
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock GitHub App utilities
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test data constants
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_OAUTH_BASE = "https://github.com/login/oauth";

const mockRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo.git",
  invalid: "https://gitlab.com/test-owner/test-repo",
};

const mockGitHubResponses = {
  pushPermission: {
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
  },
  adminPermission: {
    ok: true,
    status: 200,
    json: async () => ({
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
  },
  maintainPermission: {
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
  },
  pullOnlyPermission: {
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
  },
  repositoryNotFound: {
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: async () => "Not Found",
  },
  accessForbidden: {
    ok: false,
    status: 403,
    statusText: "Forbidden",
    text: async () => "Forbidden",
  },
  serverError: {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: async () => "Internal Server Error",
  },
};

describe("GitHub App OAuth Callback Integration Tests", () => {
  let testUser: any;
  let testWorkspace: any;
  let testSession: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();

    // Create test user and workspace
    testUser = await createTestUser({
      name: "Test User",
      email: `test-${generateUniqueId()}@example.com`,
    });

    testWorkspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: `test-workspace-${generateUniqueId()}`,
      ownerId: testUser.id,
    });
  });

  afterEach(async () => {
    // Cleanup test data
    if (testSession?.id) {
      await db.session.deleteMany({ where: { userId: testUser.id } });
    }
  });

  describe("GET /api/github/app/callback - checkRepositoryAccess validation", () => {
    describe("Success scenarios - permission validation", () => {
      test("should successfully validate repository access with push permissions", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_123";

        // Create session with GitHub state for CSRF validation
        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "gho_test_access_token",
            refresh_token: "gho_test_refresh_token",
            token_type: "bearer",
          }),
        });

        // Mock GitHub user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            login: "test-owner",
            id: 12345,
            type: "User",
          }),
        });

        // Mock GitHub user installations (required for installation_id lookup)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 123456,
                account: {
                  login: "test-owner",
                  type: "User",
                  name: "Test Owner",
                  avatar_url: "https://example.com/avatar.jpg"
                }
              }
            ]
          })
        });

        // Mock repository access check - push permission
        mockFetch.mockResolvedValueOnce(mockGitHubResponses.pushPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307); // Redirect
        const location = response.headers.get("Location");
        expect(location).toContain(`/w/${testWorkspace.slug}`);
        expect(location).toContain("repository_access=accessible");
        expect(location).toContain("github_setup_action=install");

        // Verify repository access check was called
        expect(mockFetch).toHaveBeenCalledWith(
          `${GITHUB_API_BASE}/repos/test-owner/test-repo`,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: expect.stringContaining("Bearer"),
              Accept: "application/vnd.github.v3+json",
            }),
          })
        );
      });

      test("should detect read-only access and block with read_only_blocked status", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_456";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "gho_test_access_token",
          }),
        });

        // Mock GitHub user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            login: "test-owner",
            id: 12345,
          }),
        });

        // Mock GitHub user installations (required for installation_id lookup)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 123456,
                account: {
                  login: "test-owner",
                  type: "User",
                  name: "Test Owner",
                  avatar_url: "https://example.com/avatar.jpg"
                }
              }
            ]
          })
        });

        // Mock repository access check - pull-only permission
        mockFetch.mockResolvedValueOnce(
          mockGitHubResponses.pullOnlyPermission
        );

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=read_only_blocked");
      });

      test("should validate admin permission grants push access", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_admin";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock GitHub user installations (required for installation_id lookup)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 123456,
                account: {
                  login: "test-owner",
                  type: "User",
                  name: "Test Owner",
                  avatar_url: "https://example.com/avatar.jpg"
                }
              }
            ]
          })
        });

        // Mock admin permission
        mockFetch.mockResolvedValueOnce(mockGitHubResponses.adminPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=accessible");
      });

      test("should validate maintain permission grants push access", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_maintain";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock maintain permission
        mockFetch.mockResolvedValueOnce(mockGitHubResponses.maintainPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=accessible");
      });
    });

    describe("Authentication and CSRF validation scenarios", () => {
      test("should return missing_state error when state parameter is missing", async () => {
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            code: "test_code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("error=missing_state");
      });

      test("should return missing_code error when code parameter is missing", async () => {
        const state = createMockState(testWorkspace.slug);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("error=missing_code");
      });

      test("should return invalid_state error when state does not match session", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code";

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // No session created with matching githubState

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("error=invalid_state");
      });

      test("should return state_expired error when state is older than 1 hour", async () => {
        const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
        const state = createMockState(testWorkspace.slug, oldTimestamp);
        const code = "test_oauth_code";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("error=state_expired");
      });

      test("should redirect to /auth when user is not authenticated", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const state = createMockState(testWorkspace.slug);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code: "test_code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("/auth");
      });
    });

    describe("GitHub API error scenarios in checkRepositoryAccess", () => {
      test("should handle repository not found (404) error", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_404";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock 404 repository not found
        mockFetch.mockResolvedValueOnce(
          mockGitHubResponses.repositoryNotFound
        );

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain(
          "repository_access=repository_not_found_or_no_access"
        );
      });

      test("should handle access forbidden (403) error", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_403";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock 403 access forbidden
        mockFetch.mockResolvedValueOnce(mockGitHubResponses.accessForbidden);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=access_forbidden");
      });

      test("should handle GitHub API server error (500)", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_500";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock 500 server error
        mockFetch.mockResolvedValueOnce(mockGitHubResponses.serverError);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=http_error_500");
      });

      test("should handle network errors during repository access check", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_network";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        // Mock network error
        mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=check_failed");
      });
    });

    describe("Token exchange and encryption scenarios", () => {
      test("should return invalid_code error when token exchange fails", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "invalid_oauth_code";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock failed token exchange
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        });

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("Location");
        expect(location).toContain("error=invalid_code");
      });

      test("should encrypt tokens before storing in database", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_encrypt";
        const testAccessToken = "gho_test_access_token_to_encrypt";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: testAccessToken }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        await GET(request);

        // Verify token was encrypted
        const sourceControlToken = await db.sourceControlToken.findFirst({
          where: { userId: testUser.id },
        });

        expect(sourceControlToken).toBeTruthy();
        expect(sourceControlToken!.token).toBeTruthy();

        // Token should be JSON-stringified encrypted data
        const tokenData = JSON.parse(sourceControlToken!.token);
        expect(tokenData).toHaveProperty("data");
        expect(tokenData).toHaveProperty("iv");
        expect(tokenData).toHaveProperty("tag");

        // Verify decryption works
        const encryptionService = EncryptionService.getInstance();
        const decrypted = encryptionService.decryptField(
          "source_control_token",
          sourceControlToken!.token
        );
        expect(decrypted).toBe(testAccessToken);
      });
    });

    describe("URL format validation in checkRepositoryAccess", () => {
      test("should support HTTPS repository URL format", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_https";

        // Create workspace with HTTPS repo URL
        const workspaceWithSwarm = await db.workspace.update({
          where: { id: testWorkspace.id },
          data: {
            swarm: {
              create: {
                name: "Test Swarm",
                repositoryUrl: mockRepositoryUrls.https,
              },
            },
          },
        });

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        mockFetch.mockResolvedValueOnce(mockGitHubResponses.pushPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=accessible");

        // Verify correct API endpoint was called
        expect(mockFetch).toHaveBeenCalledWith(
          `${GITHUB_API_BASE}/repos/test-owner/test-repo`,
          expect.any(Object)
        );
      });

      test("should support SSH repository URL format", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_ssh";

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: {
            swarm: {
              create: {
                name: "Test Swarm SSH",
                repositoryUrl: mockRepositoryUrls.ssh,
              },
            },
          },
        });

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        mockFetch.mockResolvedValueOnce(mockGitHubResponses.pushPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=accessible");
      });

      test("should support repository URL with .git suffix", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_git_suffix";

        await db.workspace.update({
          where: { id: testWorkspace.id },
          data: {
            swarm: {
              create: {
                name: "Test Swarm Git Suffix",
                repositoryUrl: mockRepositoryUrls.httpsWithGit,
              },
            },
          },
        });

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        mockFetch.mockResolvedValueOnce(mockGitHubResponses.pushPermission);

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=accessible");
      });
    });

    describe("Error handling edge cases", () => {
      test("should handle missing repository URL scenario", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_no_repo";

        // Workspace has no swarm/repository URL

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("Location");
        expect(location).toContain("repository_access=no_repository_url");
      });

      test("should clear GitHub state from session after successful validation", async () => {
        const state = createMockState(testWorkspace.slug);
        const code = "test_oauth_code_state_clear";

        testSession = await db.session.create({
          data: {
            userId: testUser.id,
            sessionToken: `session_token_${generateUniqueId()}`,
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            githubState: state,
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_test_token" }),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ login: "test-owner", id: 12345 }),
        });

        const request = createGetRequest(
          `http://localhost:3000/api/github/app/callback`,
          {
            state,
            code,
            installation_id: "123456",
            setup_action: "install",
          }
        );

        await GET(request);

        // Verify state was cleared
        const updatedSession = await db.session.findFirst({
          where: { userId: testUser.id },
        });

        expect(updatedSession?.githubState).toBeNull();
      });
    });
  });
});

// Helper function to create mock state
function createMockState(
  workspaceSlug: string,
  timestamp: number = Date.now()
): string {
  const stateData = {
    workspaceSlug,
    timestamp,
    repositoryUrl: mockRepositoryUrls.https,
  };
  return Buffer.from(JSON.stringify(stateData)).toString("base64");
}