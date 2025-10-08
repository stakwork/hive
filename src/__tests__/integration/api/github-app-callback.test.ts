import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/github/app/callback/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { NextRequest } from "next/server";
import {
  createTestUser,
  createTestWorkspace,
  generateUniqueId,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock next-auth
vi.mock("next-auth/next");

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GET /api/github/app/callback Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to create a valid state token
   */
  function createStateToken(data: {
    workspaceSlug: string;
    repositoryUrl?: string;
    timestamp?: number;
  }): string {
    const stateData = {
      workspaceSlug: data.workspaceSlug,
      repositoryUrl: data.repositoryUrl || "https://github.com/test/repo",
      randomState: "test-random-state-32-bytes-long-1234",
      timestamp: data.timestamp || Date.now(),
    };
    return Buffer.from(JSON.stringify(stateData)).toString("base64");
  }

  /**
   * Helper to mock successful OAuth token exchange
   */
  function mockSuccessfulTokenExchange(
    accessToken = "ghu_test_access_token",
    refreshToken = "ghr_test_refresh_token"
  ) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
    } as Response);
  }

  /**
   * Helper to mock successful GitHub user info fetch
   */
  function mockGitHubUserInfo(login = "testuser", type = "User") {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 123456,
        login,
        type,
        name: "Test User",
        avatar_url: "https://avatars.githubusercontent.com/u/123456",
      }),
    } as Response);
  }

  /**
   * Helper to mock GitHub installations fetch
   */
  function mockGitHubInstallations(installationId = 789, accountLogin = "testuser") {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        installations: [
          {
            id: installationId,
            account: {
              login: accountLogin,
              type: "User",
              avatar_url: "https://avatars.githubusercontent.com/u/123456",
            },
          },
        ],
      }),
    } as Response);
  }

  describe("Authentication", () => {
    test("should redirect to /auth for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const state = createStateToken({ workspaceSlug: "test-workspace" });
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=123`
      );

      const response = await GET(request);

      expect(response.status).toBe(307); // Temporary redirect
      expect(response.headers.get("location")).toBe("/auth");
    });

    test("should redirect with error for missing state parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?code=test-code&installation_id=123"
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/?error=missing_state");
    });

    test("should redirect with error for missing code parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const state = createStateToken({ workspaceSlug: "test-workspace" });
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&installation_id=123`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/?error=missing_code");
    });
  });

  describe("State Validation", () => {
    test("should redirect with error for invalid state (not in session)", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const state = createStateToken({ workspaceSlug: "test-workspace" });
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=123`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/?error=invalid_state");
    });

    test("should redirect with error for expired state (>1 hour)", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create expired state (2 hours ago)
      const expiredTimestamp = Date.now() - 2 * 60 * 60 * 1000;
      const state = createStateToken({
        workspaceSlug: workspace.slug,
        timestamp: expiredTimestamp,
      });

      // Store state in session
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=123`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/?error=state_expired");
    });

    test("should accept valid state within 1 hour", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });

      // Store state in session
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock OAuth flow
      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations(789, "testuser");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).not.toContain("error=");
    });
  });

  describe("OAuth Token Exchange", () => {
    test("should exchange authorization code for access token", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const accessToken = "ghu_new_access_token_123";
      const refreshToken = "ghr_new_refresh_token_456";

      mockSuccessfulTokenExchange(accessToken, refreshToken);
      mockGitHubUserInfo();
      mockGitHubInstallations();

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-auth-code&installation_id=789`
      );

      await GET(request);

      // Verify token exchange was called
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            client_id: "test-client-id",
            client_secret: "test-client-secret",
            code: "test-auth-code",
            state,
          }),
        })
      );
    });

    test("should redirect with error for invalid authorization code", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock failed token exchange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=invalid-code&installation_id=789`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      // The endpoint catches the error and redirects with generic error
      expect(response.headers.get("location")).toContain("error=");
    });
  });

  describe("Token Encryption and Storage", () => {
    test("should encrypt and store tokens in SourceControlToken", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const accessToken = "ghu_secret_access_token";
      const refreshToken = "ghr_secret_refresh_token";

      mockSuccessfulTokenExchange(accessToken, refreshToken);
      mockGitHubUserInfo("testuser", "User");
      mockGitHubInstallations(789, "testuser");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      await GET(request);

      // Verify SourceControlOrg was created
      const sourceControlOrg = await db.sourceControlOrg.findUnique({
        where: { githubLogin: "testuser" },
      });

      expect(sourceControlOrg).toBeDefined();
      expect(sourceControlOrg?.githubInstallationId).toBe(789);
      expect(sourceControlOrg?.type).toBe("USER");

      // Verify SourceControlToken was created with encrypted tokens
      const sourceControlToken = await db.sourceControlToken.findFirst({
        where: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg!.id,
        },
      });

      expect(sourceControlToken).toBeDefined();

      // Verify tokens are encrypted (stored as JSON strings)
      expect(sourceControlToken?.token).toMatch(/^\{.*\}$/);
      expect(sourceControlToken?.refreshToken).toMatch(/^\{.*\}$/);

      // Decrypt and verify tokens
      const decryptedAccessToken = encryptionService.decryptField(
        "source_control_token",
        sourceControlToken!.token
      );
      const decryptedRefreshToken = encryptionService.decryptField(
        "source_control_refresh_token",
        sourceControlToken!.refreshToken!
      );

      expect(decryptedAccessToken).toBe(accessToken);
      expect(decryptedRefreshToken).toBe(refreshToken);
    });

    test("should update existing token if already exists", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create existing SourceControlOrg and Token
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "testuser",
          githubInstallationId: 789,
          type: "USER",
        },
      });

      const oldAccessToken = "ghu_old_access_token";
      const encryptedOldToken = JSON.stringify(
        encryptionService.encryptField("source_control_token", oldAccessToken)
      );

      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: encryptedOldToken,
        },
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const newAccessToken = "ghu_new_access_token";
      const newRefreshToken = "ghr_new_refresh_token";

      mockSuccessfulTokenExchange(newAccessToken, newRefreshToken);
      mockGitHubUserInfo("testuser", "User");
      mockGitHubInstallations(789, "testuser");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      await GET(request);

      // Verify only one token exists
      const tokens = await db.sourceControlToken.findMany({
        where: { userId: user.id },
      });
      expect(tokens).toHaveLength(1);

      // Verify token was updated
      const decryptedAccessToken = encryptionService.decryptField(
        "source_control_token",
        tokens[0].token
      );
      expect(decryptedAccessToken).toBe(newAccessToken);
    });
  });

  describe("SourceControlOrg Management", () => {
    test("should create SourceControlOrg for organization installation", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();

      // Mock org installation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 1,
          installations: [
            {
              id: 999,
              account: {
                login: "myorg",
                type: "Organization",
                name: "My Organization",
                avatar_url: "https://avatars.githubusercontent.com/o/999",
                description: "Test organization",
              },
            },
          ],
        }),
      } as Response);

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=999`
      );

      await GET(request);

      const sourceControlOrg = await db.sourceControlOrg.findUnique({
        where: { githubLogin: "myorg" },
      });

      expect(sourceControlOrg).toMatchObject({
        githubLogin: "myorg",
        githubInstallationId: 999,
        type: "ORG",
        name: "My Organization",
        avatarUrl: "https://avatars.githubusercontent.com/o/999",
        description: "Test organization",
      });
    });

    test("should update installation ID if changed", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create existing SourceControlOrg with old installation ID
      const existingOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "testuser",
          githubInstallationId: 123,
          type: "USER",
        },
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations(789, "testuser");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      await GET(request);

      const updatedOrg = await db.sourceControlOrg.findUnique({
        where: { id: existingOrg.id },
      });

      expect(updatedOrg?.githubInstallationId).toBe(789);
    });
  });

  describe("Workspace Linking", () => {
    test("should link workspace to SourceControlOrg on install action", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations();

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789&setup_action=install`
      );

      await GET(request);

      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
        include: { sourceControlOrg: true },
      });

      expect(updatedWorkspace?.sourceControlOrg).toBeDefined();
      expect(updatedWorkspace?.sourceControlOrg?.githubLogin).toBe("testuser");
    });

    test("should unlink workspace on uninstall action", async () => {
      const user = await createTestUser();

      // Create SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "testuser",
          githubInstallationId: 789,
          type: "USER",
        },
      });

      // Create workspace linked to org
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
        sourceControlOrgId: sourceControlOrg.id,
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations();

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789&setup_action=uninstall`
      );

      await GET(request);

      const updatedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });

      expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
    });
  });

  describe("Session State Cleanup", () => {
    test("should clear githubState from session after successful callback", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      // Verify state is stored
      const sessionBefore = await db.session.findFirst({
        where: { userId: user.id },
      });
      expect(sessionBefore?.githubState).toBe(state);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations();

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      await GET(request);

      // Verify state is cleared
      const sessionAfter = await db.session.findFirst({
        where: { userId: user.id },
      });
      expect(sessionAfter?.githubState).toBeNull();
    });
  });

  describe("OAuth-only Flow (No Installation ID)", () => {
    test("should handle OAuth authorization without installation ID", async () => {
      const user = await createTestUser();

      // Create existing SourceControlOrg
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "testuser",
          githubInstallationId: 789,
          type: "USER",
        },
      });

      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
        sourceControlOrgId: sourceControlOrg.id,
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();

      // No installation_id parameter
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code`
      );

      await GET(request);

      // Verify token was created/updated
      const token = await db.sourceControlToken.findFirst({
        where: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      });

      expect(token).toBeDefined();
    });

    test("should redirect with error when OAuth-only but no existing org", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();

      // No installation_id and no existing SourceControlOrg
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain(
        "error=no_installation_found"
      );
    });
  });

  describe("Error Handling", () => {
    test("should handle GitHub user fetch failure", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();

      // Mock failed user info fetch
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain(
        "error=github_user_fetch_failed"
      );
    });

    test("should handle generic errors", async () => {
      const user = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Invalid state that will cause JSON parse error
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=invalid-base64&code=test-code&installation_id=789`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("error=invalid_state");
    });
  });

  describe("Redirect URLs", () => {
    test("should redirect to workspace with setup action parameter", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const state = createStateToken({ workspaceSlug: workspace.slug });
      await db.session.updateMany({
        where: { userId: user.id },
        data: { githubState: state },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockSuccessfulTokenExchange();
      mockGitHubUserInfo();
      mockGitHubInstallations();

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${state}&code=test-code&installation_id=789&setup_action=install`
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      const location = response.headers.get("location");
      expect(location).toContain(`/w/${workspace.slug}`);
      expect(location).toContain("github_setup_action=install");
    });
  });
});