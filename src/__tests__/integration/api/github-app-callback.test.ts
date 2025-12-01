import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/callback/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import {
  mockSuccessfulGitHubAppFlow,
  mockGitHubTokenExchange,
  mockGitHubUser,
  mockGitHubInstallations,
  mockGitHubRepository,
} from "@/__tests__/support/helpers/service-mocks";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock env module with GitHub App config
vi.mock("@/config/env", () => ({
  config: {
    GITHUB_APP_CLIENT_ID: "test_client_id_123",
    GITHUB_APP_CLIENT_SECRET: "test_client_secret_456",
  },
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub App Callback API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("GET /api/github/app/callback", () => {
    describe("Success scenarios", () => {
      test("should handle successful OAuth callback with valid code and state", async () => {
        const testUser = await createTestUser({ name: "Test User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "test-workspace",
          repositoryDraft: "https://github.com/test-owner/test-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Encode state with workspace slug and timestamp
        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock GitHub token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "ghu_test_access_token",
            refresh_token: "ghr_test_refresh_token",
          }),
        });

        // Mock GitHub user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 12345,
            login: "test-owner",
            name: "Test Owner",
            avatar_url: "https://avatars.github.com/u/12345",
          }),
        });

        // Mock GitHub installations fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            installations: [
              {
                id: 98765,
                account: {
                  login: "test-owner",
                  type: "User",
                  avatar_url: "https://avatars.github.com/u/12345",
                },
              },
            ],
          }),
        });

        // Mock repository access check
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
              admin: false,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_oauth_code",
            state,
            installation_id: "98765",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        // Verify redirect
        expect(response.status).toBe(307); // NextResponse.redirect status
        const location = response.headers.get("location");
        expect(location).toContain(`/w/${workspace.slug}`);
        expect(location).toContain("github_setup_action=install");
        expect(location).toContain("repository_access=accessible");

        // Verify token exchange API call
        expect(mockFetch).toHaveBeenCalledWith(
          "https://github.com/login/oauth/access_token",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("test_oauth_code"),
          })
        );

        // Verify SourceControlOrg creation
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: "test-owner" },
        });
        expect(sourceControlOrg).toBeTruthy();
        expect(sourceControlOrg?.type).toBe("USER");
        expect(sourceControlOrg?.githubInstallationId).toBe(98765);

        // Verify SourceControlToken creation with encrypted tokens
        const token = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg!.id,
            },
          },
        });
        expect(token).toBeTruthy();

        // Verify token encryption structure
        const encryptedAccessToken = JSON.parse(token!.token);
        expect(encryptedAccessToken).toHaveProperty("data");
        expect(encryptedAccessToken).toHaveProperty("iv");
        expect(encryptedAccessToken).toHaveProperty("tag");
        expect(encryptedAccessToken).toHaveProperty("keyId");

        // Verify token can be decrypted
        const encryptionService = EncryptionService.getInstance();
        const decryptedToken = encryptionService.decryptField(
          "source_control_token",
          token!.token
        );
        expect(decryptedToken).toBe("ghu_test_access_token");

        // Verify workspace linking
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg!.id);
      });

      test("should handle OAuth callback without installation_id (OAuth-only flow)", async () => {
        const testUser = await createTestUser({ name: "OAuth User" });

        // Create existing SourceControlOrg
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "existing-owner",
            githubInstallationId: 55555,
            name: "Existing Owner",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "oauth-workspace",
          sourceControlOrgId: sourceControlOrg.id,
          repositoryDraft: "https://github.com/existing-owner/oauth-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "ghu_oauth_token",
            refresh_token: "ghr_oauth_refresh",
          }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 67890,
            login: "existing-owner",
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "oauth_code",
            state,
            // No installation_id - OAuth-only flow
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain(`/w/${workspace.slug}`);

        // Verify SourceControlToken was created/updated
        const token = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg.id,
            },
          },
        });
        expect(token).toBeTruthy();

        // Verify encryption
        const encryptionService = EncryptionService.getInstance();
        const decryptedToken = encryptionService.decryptField(
          "source_control_token",
          token!.token
        );
        expect(decryptedToken).toBe("ghu_oauth_token");
      });

      test("should handle repository access validation with push permissions", async () => {
        const testUser = await createTestUser({ name: "Push User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "push-workspace",
          repositoryDraft: "https://github.com/push-owner/push-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_push_token",
          }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 11111,
            login: "push-owner",
          }),
        });

        // Mock installations fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 22222,
                account: { login: "push-owner", type: "User" },
              },
            ],
          }),
        });

        // Mock repository access with push permission
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: "push-repo",
            full_name: "push-owner/push-repo",
            private: false,
            default_branch: "main",
            permissions: {
              push: true,
              admin: false,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "push_code",
            state,
            installation_id: "22222",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access=accessible");
      });

      test("should handle repository access validation with read-only permissions", async () => {
        const testUser = await createTestUser({ name: "Read User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "read-workspace",
          repositoryDraft: "https://github.com/read-owner/read-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "ghu_read_token" }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 33333, login: "read-owner" }),
        });

        // Mock installations
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 44444,
                account: { login: "read-owner", type: "User" },
              },
            ],
          }),
        });

        // Mock repository access with only pull permission
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: "read-repo",
            full_name: "read-owner/read-repo",
            permissions: {
              push: false,
              admin: false,
              pull: true,
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "read_code",
            state,
            installation_id: "44444",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access=read_only_blocked");
      });

      test("should handle admin permissions granting push access", async () => {
        const testUser = await createTestUser({ name: "Admin User" });
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "admin-workspace",
          repositoryDraft: "https://github.com/admin-owner/admin-repo",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "ghu_admin_token" }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 55555, login: "admin-owner" }),
        });

        // Mock installations
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 66666,
                account: { login: "admin-owner", type: "User" },
              },
            ],
          }),
        });

        // Mock repository access with admin permission
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            name: "admin-repo",
            full_name: "admin-owner/admin-repo",
            permissions: {
              push: false,
              admin: true, // Admin grants push
            },
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "admin_code",
            state,
            installation_id: "66666",
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access=accessible");
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should redirect to /auth for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const stateData = {
          workspaceSlug: "test-workspace",
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("/auth");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should redirect to /auth for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const stateData = {
          workspaceSlug: "test-workspace",
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("/auth");
      });
    });

    describe("Input validation scenarios", () => {
      test("should redirect with error for missing state parameter", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            // Missing state
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=missing_state");
      });

      test("should redirect with error for missing code parameter", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: "test-workspace",
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state,
            // Missing code
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=missing_code");
      });

      test("should redirect with error for expired state (older than 1 hour)", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Create state with timestamp older than 1 hour
        const stateData = {
          workspaceSlug: "test-workspace",
          timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock successful token exchange (so we can reach state validation)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_test_token",
          }),
        });

        // Mock successful user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 12345,
            login: "test-user",
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=state_expired");
      });

      test("should redirect with error for malformed state", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Invalid base64 or invalid JSON
        const state = "invalid_state_not_base64";

        // Mock successful token exchange (so we can reach state validation)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_test_token",
          }),
        });

        // Mock successful user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 12345,
            login: "test-user",
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=invalid_state");
      });
    });

    describe("Token exchange scenarios", () => {
      test("should redirect with error when token exchange fails", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "token-fail-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock failed token exchange
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "invalid_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=github_app_callback_error");
      });

      test("should redirect with error when GitHub returns invalid code", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "invalid-code-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange returning no access_token
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            error: "bad_verification_code",
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "bad_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=invalid_code");
      });
    });

    describe("GitHub API error scenarios", () => {
      test("should redirect with error when user fetch fails", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "user-fetch-fail",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock successful token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_token",
          }),
        });

        // Mock failed user fetch
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=github_user_fetch_failed");
      });

      test("should handle network errors gracefully", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "network-error-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=github_app_callback_error");
      });
    });

    describe("Database operation scenarios", () => {
      test("should update existing SourceControlToken instead of creating new one", async () => {
        const testUser = await createTestUser();

        // Create existing SourceControlOrg
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "existing-user",
            githubInstallationId: 77777,
            name: "Existing User",
          },
        });

        // Create existing token
        const encryptionService = EncryptionService.getInstance();
        const existingToken = await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: JSON.stringify(
              encryptionService.encryptField(
                "source_control_token",
                "old_token"
              )
            ),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "update-token-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "new_access_token",
            refresh_token: "new_refresh_token",
          }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 88888,
            login: "existing-user",
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "update_code",
            state,
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);

        // Verify token was updated, not created
        const tokenCount = await db.sourceControlToken.count({
          where: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
          },
        });
        expect(tokenCount).toBe(1); // Still only one token

        const updatedToken = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg.id,
            },
          },
        });

        // Verify token was updated with new value
        const decryptedToken = encryptionService.decryptField(
          "source_control_token",
          updatedToken!.token
        );
        expect(decryptedToken).toBe("new_access_token");
        expect(decryptedToken).not.toBe("old_token");
      });

      test("should update SourceControlOrg installation ID when changed", async () => {
        const testUser = await createTestUser();

        // Create SourceControlOrg with old installation ID
        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "ORG",
            githubLogin: "test-org",
            githubInstallationId: 11111, // Old ID
            name: "Test Organization",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "update-install-workspace",
          sourceControlOrgId: sourceControlOrg.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "ghu_org_token" }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 99999, login: "test-org" }),
        });

        // Mock installations with NEW installation ID
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 22222, // New installation ID
                account: {
                  login: "test-org",
                  type: "Organization",
                },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "org_code",
            state,
            installation_id: "22222", // New ID
            setup_action: "update",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);

        // Verify installation ID was updated
        const updatedOrg = await db.sourceControlOrg.findUnique({
          where: { id: sourceControlOrg.id },
        });
        expect(updatedOrg?.githubInstallationId).toBe(22222);
        expect(updatedOrg?.githubInstallationId).not.toBe(11111);
      });
    });

    describe("Encryption validation", () => {
      test("should encrypt tokens with proper AES-256-GCM structure", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "encrypt-test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_encryption_test_token",
            refresh_token: "ghr_encryption_test_refresh",
          }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 55555, login: "encrypt-user" }),
        });

        // Mock installations
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 66666,
                account: { login: "encrypt-user", type: "User" },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "encrypt_code",
            state,
            installation_id: "66666",
          }
        );

        const response = await GET(request);
        expect(response.status).toBe(307);

        // Retrieve stored token
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: "encrypt-user" },
        });
        const token = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg!.id,
            },
          },
        });

        // Verify encrypted structure for access token
        const encryptedAccessToken = JSON.parse(token!.token);
        expect(encryptedAccessToken).toHaveProperty("data");
        expect(encryptedAccessToken).toHaveProperty("iv");
        expect(encryptedAccessToken).toHaveProperty("tag");
        expect(encryptedAccessToken).toHaveProperty("keyId");

        expect(typeof encryptedAccessToken.data).toBe("string");
        expect(typeof encryptedAccessToken.iv).toBe("string");
        expect(typeof encryptedAccessToken.tag).toBe("string");
        expect(typeof encryptedAccessToken.keyId).toBe("string");

        // Verify encrypted structure for refresh token
        const encryptedRefreshToken = JSON.parse(token!.refreshToken!);
        expect(encryptedRefreshToken).toHaveProperty("data");
        expect(encryptedRefreshToken).toHaveProperty("iv");
        expect(encryptedRefreshToken).toHaveProperty("tag");
        expect(encryptedRefreshToken).toHaveProperty("keyId");

        // Verify decryption works correctly
        const encryptionService = EncryptionService.getInstance();
        const decryptedAccess = encryptionService.decryptField(
          "source_control_token",
          token!.token
        );
        const decryptedRefresh = encryptionService.decryptField(
          "source_control_refresh_token",
          token!.refreshToken!
        );

        expect(decryptedAccess).toBe("ghu_encryption_test_token");
        expect(decryptedRefresh).toBe("ghr_encryption_test_refresh");
      });

      test("should set correct expiration time for refresh tokens (8 hours)", async () => {
        const testUser = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "expiry-test-workspace",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        const beforeTime = Date.now();

        // Mock token exchange with refresh token
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "ghu_expiry_token",
            refresh_token: "ghr_expiry_refresh",
          }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 77777, login: "expiry-user" }),
        });

        // Mock installations
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 88888,
                account: { login: "expiry-user", type: "User" },
              },
            ],
          }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "expiry_code",
            state,
            installation_id: "88888",
          }
        );

        const response = await GET(request);
        expect(response.status).toBe(307);

        const afterTime = Date.now();

        // Retrieve stored token
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: "expiry-user" },
        });
        const token = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: testUser.id,
              sourceControlOrgId: sourceControlOrg!.id,
            },
          },
        });

        expect(token?.expiresAt).toBeTruthy();

        // Verify expiration is approximately 8 hours from now
        const expiresAtMs = token!.expiresAt!.getTime();
        const expectedMinExpiry = beforeTime + 8 * 60 * 60 * 1000;
        const expectedMaxExpiry = afterTime + 8 * 60 * 60 * 1000;

        expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMinExpiry);
        expect(expiresAtMs).toBeLessThanOrEqual(expectedMaxExpiry);
      });
    });

    describe("Setup action scenarios", () => {
      test("should handle uninstall action by unlinking workspace", async () => {
        const testUser = await createTestUser();

        const sourceControlOrg = await db.sourceControlOrg.create({
          data: {
            type: "USER",
            githubLogin: "uninstall-user",
            githubInstallationId: 99999,
            name: "Uninstall User",
          },
        });

        const workspace = await createTestWorkspace({
          ownerId: testUser.id,
          slug: "uninstall-workspace",
          sourceControlOrgId: sourceControlOrg.id, // Initially linked
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const stateData = {
          workspaceSlug: workspace.slug,
          timestamp: Date.now(),
        };
        const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

        // Mock token exchange
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "ghu_uninstall_token" }),
        });

        // Mock user fetch
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 11111, login: "uninstall-user" }),
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "uninstall_code",
            state,
            setup_action: "uninstall",
          }
        );

        const response = await GET(request);
        expect(response.status).toBe(307);

        // Verify workspace was unlinked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
      });
    });
  });
});