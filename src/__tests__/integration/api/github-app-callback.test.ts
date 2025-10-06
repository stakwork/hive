import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/github/app/callback/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  getMockedSession,
  createGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createTestWorkspaceWithRepo,
  createTestWorkspaceWithSourceControl,
  createTestSessionWithState,
  generateTestState,
  generateExpiredState,
  mockGitHubInstallationResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-app-installation";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

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

// Mock getAccessToken helper (used in callback endpoint)
vi.mock("@/app/api/github/app/callback/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/github/app/callback/route")>();
  return {
    ...actual,
    // We'll need to mock the internal getAccessToken function
  };
});

describe("GitHub App Callback API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/github/app/callback", () => {
    describe("Session authentication", () => {
      test("should redirect to /auth for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: "test-state",
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307); // Redirect
        expect(response.headers.get("location")).toBe("/auth");
      });

      test("should redirect to /auth for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
        });

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: "test-state",
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("/auth");
      });
    });

    describe("CSRF state validation", () => {
      test("should redirect with error for missing state parameter", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=missing_state");
      });

      test("should redirect with error for missing code parameter", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: "test-state",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=missing_code");
      });

      test("should redirect with error for invalid state (not in session)", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const invalidState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: invalidState,
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=invalid_state");
      });

      test("should redirect with error for expired state (older than 1 hour)", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const expiredState = generateExpiredState(workspace.slug);

        // Store expired state in session
        await createTestSessionWithState(testUser.id, expiredState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange success
        mockFetch.mockResolvedValueOnce(
          mockGitHubInstallationResponses.tokenExchangeSuccess
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: expiredState,
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=state_expired");
      });

      test("should clear state from session after successful validation", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: "123456789",
          }
        );

        const response = await GET(request);

        // State should be cleared from session
        const session = await db.session.findFirst({
          where: { userId: testUser.id },
        });
        expect(session?.githubState).toBeNull();
      });
    });

    describe("OAuth token exchange", () => {
      test("should successfully exchange code for access and refresh tokens", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "valid-oauth-code",
            installation_id: "123456789",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain(
          `/w/${workspace.slug}`
        );

        // Verify token exchange was called
        expect(mockFetch).toHaveBeenCalledWith(
          "https://github.com/login/oauth/access_token",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("valid-oauth-code"),
          })
        );
      });

      test("should redirect with error for invalid OAuth code", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange failure
        mockFetch.mockResolvedValueOnce(
          mockGitHubInstallationResponses.tokenExchangeFailed
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "invalid-code",
            installation_id: "123456789",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=invalid_code");
      });
    });

    describe("Token encryption and storage", () => {
      test("should encrypt tokens before storing in database", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: "123456789",
          }
        );

        await GET(request);

        // Verify tokens were stored encrypted
        const sourceControlToken = await db.sourceControlToken.findFirst({
          where: { userId: testUser.id },
        });

        expect(sourceControlToken).toBeDefined();
        expect(sourceControlToken?.token).toBeDefined();
        expect(sourceControlToken?.refreshToken).toBeDefined();

        // Verify tokens are encrypted (not plaintext)
        expect(sourceControlToken?.token).not.toContain("ghu_");
        expect(sourceControlToken?.refreshToken).not.toContain("ghr_");

        // Verify tokens can be decrypted
        const decryptedToken = encryptionService.decryptField(
          "source_control_token",
          sourceControlToken!.token
        );
        expect(decryptedToken).toBe("ghu_new_access_token_from_oauth");

        const decryptedRefreshToken = encryptionService.decryptField(
          "source_control_refresh_token",
          sourceControlToken!.refreshToken!
        );
        expect(decryptedRefreshToken).toBe("ghr_new_refresh_token_from_oauth");
      });

      test("should update existing tokens if user already has tokens for org", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";
        const installationId = 123456789;

        const { workspace, sourceControlOrg } =
          await createTestWorkspaceWithSourceControl({
            ownerId: testUser.id,
            githubLogin: githubOwner,
            githubInstallationId: installationId,
          });

        // Create existing token
        const encryptedOldToken = encryptionService.encryptField(
          "source_control_token",
          "old_access_token"
        );
        await db.sourceControlToken.create({
          data: {
            id: generateUniqueId("old-token"),
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: JSON.stringify(encryptedOldToken),
          },
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
          }
        );

        await GET(request);

        // Verify token was updated (not duplicated)
        const tokens = await db.sourceControlToken.findMany({
          where: {
            userId: testUser.id,
            sourceControlOrgId: sourceControlOrg.id,
          },
        });

        expect(tokens).toHaveLength(1);

        const decryptedToken = encryptionService.decryptField(
          "source_control_token",
          tokens[0].token
        );
        expect(decryptedToken).toBe("ghu_new_access_token_from_oauth");
      });
    });

    describe("SourceControlOrg creation and updates", () => {
      test("should create new SourceControlOrg when installation is new", async () => {
        const testUser = await createTestUser();
        const githubOwner = "new-org";
        const installationId = 987654321;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: `https://github.com/${githubOwner}/test-repo`,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
          }
        );

        await GET(request);

        // Verify SourceControlOrg was created
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: githubOwner },
        });

        expect(sourceControlOrg).toBeDefined();
        expect(sourceControlOrg?.githubLogin).toBe(githubOwner);
        expect(sourceControlOrg?.githubInstallationId).toBe(installationId);
        expect(sourceControlOrg?.name).toBe(`${githubOwner} Organization`);
        expect(sourceControlOrg?.type).toBe("ORG");
      });

      test("should update installation ID if it changed for existing org", async () => {
        const testUser = await createTestUser();
        const githubOwner = "existing-org";
        const oldInstallationId = 111111111;
        const newInstallationId = 222222222;

        const { workspace, sourceControlOrg } =
          await createTestWorkspaceWithSourceControl({
            ownerId: testUser.id,
            githubLogin: githubOwner,
            githubInstallationId: oldInstallationId,
          });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              newInstallationId,
              githubOwner
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: newInstallationId.toString(),
          }
        );

        await GET(request);

        // Verify installation ID was updated
        const updatedOrg = await db.sourceControlOrg.findUnique({
          where: { id: sourceControlOrg.id },
        });

        expect(updatedOrg?.githubInstallationId).toBe(newInstallationId);
      });

      test("should handle user type repositories correctly", async () => {
        const testUser = await createTestUser();
        const githubOwner = "individual-user";
        const installationId = 333333333;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.httpsUser,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls for User type
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner,
              "User"
            )
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
          }
        );

        await GET(request);

        // Verify SourceControlOrg has correct type
        const sourceControlOrg = await db.sourceControlOrg.findUnique({
          where: { githubLogin: githubOwner },
        });

        expect(sourceControlOrg?.type).toBe("USER");
      });
    });

    describe("Workspace linking", () => {
      test("should link workspace to source control org on install action", async () => {
        const testUser = await createTestUser();
        const githubOwner = "new-org";
        const installationId = 456789123;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: `https://github.com/${githubOwner}/test-repo`,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.repositoryAccessSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
            setup_action: "install",
          }
        );

        await GET(request);

        // Verify workspace is linked to source control org
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
          include: { sourceControlOrg: true },
        });

        expect(updatedWorkspace?.sourceControlOrg).toBeDefined();
        expect(updatedWorkspace?.sourceControlOrg?.githubLogin).toBe(githubOwner);
      });

      test("should unlink workspace on uninstall action", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";

        const { workspace } = await createTestWorkspaceWithSourceControl({
          ownerId: testUser.id,
          githubLogin: githubOwner,
          githubInstallationId: 123456789,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            setup_action: "uninstall",
          }
        );

        await GET(request);

        // Verify workspace is unlinked from source control org
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBeNull();
      });

      test("should include setup action in redirect URL", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            setup_action: "update",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("github_setup_action=update");
      });
    });

    describe("Repository access verification", () => {
      test("should check repository access after linking", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";
        const installationId = 123456789;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.https,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
          repositoryUrl: testRepositoryUrls.https,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.repositoryAccessSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access=accessible");

        // Verify repository access check was called
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("repos/test-owner/test-repo"),
          expect.any(Object)
        );
      });

      test("should handle read-only repository access", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";
        const installationId = 123456789;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.https,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
          repositoryUrl: testRepositoryUrls.https,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls with read-only access
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.repositoryAccessReadOnly
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access=read_only_blocked");
      });

      test("should handle repository not found", async () => {
        const testUser = await createTestUser();
        const githubOwner = "test-org";
        const installationId = 123456789;

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
          repositoryUrl: testRepositoryUrls.https,
          githubOwner,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
          repositoryUrl: testRepositoryUrls.https,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.installationsSuccess(
              installationId,
              githubOwner
            )
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.repositoryNotFound
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: installationId.toString(),
            setup_action: "install",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("repository_access");
        expect(location).not.toContain("repository_access=accessible");
      });
    });

    describe("Error handling", () => {
      test("should redirect with error for GitHub user info fetch failure", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange success but user info failure
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoFailed
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: "123456789",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain(
          "error=github_user_fetch_failed"
        );
      });

      test("should redirect with error for network failures", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain(
          "error=github_app_callback_error"
        );
      });

      test("should handle malformed state gracefully", async () => {
        const testUser = await createTestUser();

        const malformedState = "not-valid-base64!@#$%";

        await createTestSessionWithState(testUser.id, malformedState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange
        mockFetch.mockResolvedValueOnce(
          mockGitHubInstallationResponses.tokenExchangeSuccess
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: malformedState,
            code: "test-code",
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("error=invalid_state");
      });
    });

    describe("OAuth-only flow (no installation_id)", () => {
      test("should handle OAuth-only callback for existing installation", async () => {
        const testUser = await createTestUser();
        const githubOwner = "existing-org";

        const { workspace, sourceControlOrg } =
          await createTestWorkspaceWithSourceControl({
            ownerId: testUser.id,
            githubLogin: githubOwner,
            githubInstallationId: 123456789,
          });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub user info (no installation_id)
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            // No installation_id parameter
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain(
          `/w/${workspace.slug}`
        );

        // Verify SourceControlOrg remains linked
        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
      });

      test("should redirect with error for OAuth-only without existing installation", async () => {
        const testUser = await createTestUser();

        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub user info
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            // No installation_id, and no existing SourceControlOrg
          }
        );

        const response = await GET(request);

        expect(response.status).toBe(307);
        const location = response.headers.get("location");
        expect(location).toContain("error=no_installation_found");
      });
    });

    describe("Security considerations", () => {
      test("should not expose sensitive data in redirect URLs", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange failure
        mockFetch.mockResolvedValueOnce(
          mockGitHubInstallationResponses.tokenExchangeFailed
        );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
          }
        );

        const response = await GET(request);

        const location = response.headers.get("location");
        expect(location).not.toContain("userId");
        expect(location).not.toContain("accessToken");
        expect(location).not.toContain("test-code");
      });

      test("should verify tokens are properly encrypted in database", async () => {
        const testUser = await createTestUser();
        const { workspace } = await createTestWorkspaceWithRepo({
          ownerId: testUser.id,
        });

        const validState = generateTestState({
          workspaceSlug: workspace.slug,
        });

        await createTestSessionWithState(testUser.id, validState);

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        // Mock OAuth token exchange and GitHub API calls
        mockFetch
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.tokenExchangeSuccess
          )
          .mockResolvedValueOnce(
            mockGitHubInstallationResponses.userInfoSuccess
          );

        const request = createGetRequest(
          "http://localhost:3000/api/github/app/callback",
          {
            state: validState,
            code: "test-code",
            installation_id: "123456789",
          }
        );

        await GET(request);

        // Verify tokens in database are encrypted
        const sourceControlToken = await db.sourceControlToken.findFirst({
          where: { userId: testUser.id },
        });

        expect(sourceControlToken?.token).toBeDefined();

        // Verify it's JSON-stringified encrypted data
        const parsedToken = JSON.parse(sourceControlToken!.token);
        expect(parsedToken).toHaveProperty("data");
        expect(parsedToken).toHaveProperty("iv");
        expect(parsedToken).toHaveProperty("tag");

        // Verify plaintext is not stored
        expect(sourceControlToken?.token).not.toContain(
          "ghu_new_access_token_from_oauth"
        );
      });
    });
  });
});