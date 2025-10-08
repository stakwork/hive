import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/github/app/install/route";
import { db } from "@/lib/db";
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
  expectSuccess,
  expectUnauthorized,
  expectError,
} from "@/__tests__/support/helpers";

// Mock next-auth
vi.mock("next-auth/next");

// Mock getUserAppTokens from githubApp
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { getUserAppTokens } = await import("@/lib/githubApp");
const mockGetUserAppTokens = getUserAppTokens as vi.MockedFunction<
  typeof getUserAppTokens
>;

describe("POST /api/github/app/install Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: "test-workspace",
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ success: false, message: "Unauthorized" });
    });

    test("should return 401 when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: "test-workspace",
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ success: false, message: "Unauthorized" });
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when workspaceSlug is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "Workspace slug is required",
      });
    });

    test("should return 404 when workspace not found", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: "non-existent-workspace",
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        success: false,
        message: "Workspace not found",
      });
    });

    test("should return 400 when no repository URL found", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "No repository URL found for this workspace",
      });
    });

    test("should return 400 for invalid GitHub repository URL", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://gitlab.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "Invalid GitHub repository URL",
      });
    });
  });

  describe("State Generation and Storage", () => {
    test("should generate state and store in user session", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockGetUserAppTokens.mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        state: expect.any(String),
        flowType: expect.any(String),
        githubOwner: "test",
        repositoryUrl: "https://github.com/test/repo",
      });

      // Verify state is stored in session
      const userSession = await db.session.findFirst({
        where: { userId: user.id },
      });

      expect(userSession?.githubState).toBe(data.data.state);

      // Verify state can be decoded and contains expected data
      const decodedState = JSON.parse(
        Buffer.from(data.data.state, "base64").toString()
      );
      expect(decodedState).toMatchObject({
        workspaceSlug: workspace.slug,
        repositoryUrl: "https://github.com/test/repo",
        randomState: expect.any(String),
        timestamp: expect.any(Number),
      });
      expect(decodedState.randomState).toHaveLength(64); // 32 bytes as hex = 64 chars
    });
  });

  describe("Installation Detection - Database Layer", () => {
    test("should detect existing installation from database", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create existing SourceControlOrg with installation
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test",
          githubInstallationId: 12345,
          type: "ORG",
          name: "Test Organization",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toMatchObject({
        flowType: "user_authorization",
        appInstalled: true,
        installationId: 12345,
        githubOwner: "test",
        ownerType: "org",
      });

      // Verify URL is for user authorization (not installation)
      expect(data.data.link).toContain("github.com/login/oauth/authorize");
      expect(data.data.link).toContain("client_id=");
      expect(data.data.link).toContain("state=");
      expect(data.data.link).not.toContain("/installations/new");
    });
  });

  describe("Installation Detection - GitHub API Layer", () => {
    test("should detect installation via GitHub API when not in database", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getUserAppTokens to return tokens
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: "ghu_test_token_123",
        refreshToken: "ghr_test_refresh_123",
      });

      // Mock GitHub API calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 123,
            login: "test",
            type: "Organization",
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 67890,
            account: { login: "test", type: "Organization" },
          }),
        } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toMatchObject({
        flowType: "user_authorization",
        appInstalled: true,
        installationId: 67890,
        githubOwner: "test",
        ownerType: "org",
      });

      // Verify GitHub API calls
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/users/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghu_test_token_123",
          }),
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/orgs/test/installation",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghu_test_token_123",
          }),
        })
      );
    });

    test("should return installation flow when app not installed", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockGetUserAppTokens.mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toMatchObject({
        flowType: "installation",
        appInstalled: false,
        githubOwner: "test",
      });

      // Verify URL is for installation (not authorization)
      expect(data.data.link).toContain(
        "github.com/apps/test-github-app/installations/new"
      );
      expect(data.data.link).toContain("state=");
      expect(data.data.link).not.toContain("client_id=");
    });
  });

  describe("URL Construction", () => {
    test("should construct installation URL for organization repository", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockGetUserAppTokens.mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/myorg/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.flowType).toBe("installation");
      expect(data.data.link).toContain(
        "github.com/apps/test-github-app/installations/new"
      );
      expect(data.data.link).toContain("state=");
      // Should NOT force user target type for org repos
      expect(data.data.link).not.toContain("target_type=User");
    });

    test("should construct installation URL with target_type=User for user repository", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getUserAppTokens with tokens
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: "ghu_test_token",
      });

      // Mock GitHub API to return User type
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 123,
            login: "testuser",
            type: "User",
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/testuser/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.flowType).toBe("installation");
      expect(data.data.ownerType).toBe("user");
      expect(data.data.link).toContain("target_type=User");
    });

    test("should construct user authorization URL when app already installed", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create existing installation
      await db.sourceControlOrg.create({
        data: {
          githubLogin: "testorg",
          githubInstallationId: 99999,
          type: "ORG",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/testorg/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.flowType).toBe("user_authorization");
      expect(data.data.appInstalled).toBe(true);
      expect(data.data.link).toContain("github.com/login/oauth/authorize");
      expect(data.data.link).toContain("client_id=test-client-id");
      expect(data.data.link).toContain("state=");
    });
  });

  describe("Repository URL Parsing", () => {
    test.each([
      {
        url: "https://github.com/owner/repo",
        expectedOwner: "owner",
        description: "HTTPS URL",
      },
      {
        url: "git@github.com:owner/repo.git",
        expectedOwner: "owner",
        description: "SSH URL with .git",
      },
      {
        url: "https://github.com/owner/repo.git",
        expectedOwner: "owner",
        description: "HTTPS URL with .git",
      },
      {
        url: "git@github.com:owner/repo",
        expectedOwner: "owner",
        description: "SSH URL without .git",
      },
    ])(
      "should extract GitHub owner from $description",
      async ({ url, expectedOwner }) => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
        mockGetUserAppTokens.mockResolvedValue(null);

        const request = new NextRequest(
          "http://localhost:3000/api/github/app/install",
          {
            method: "POST",
            body: JSON.stringify({
              workspaceSlug: workspace.slug,
              repositoryUrl: url,
            }),
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 200);

        expect(data.data.githubOwner).toBe(expectedOwner);
      }
    );
  });

  describe("Error Handling", () => {
    test("should handle GitHub API failures gracefully", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getUserAppTokens with tokens
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: "ghu_test_token",
      });

      // Mock GitHub API to fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Should fallback to installation flow when API check fails
      expect(data.data.flowType).toBe("installation");
      expect(data.data.appInstalled).toBe(false);
    });

    test("should return 500 for unexpected errors", async () => {
      const user = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Force an error by not creating the workspace
      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: "non-existent",
            repositoryUrl: "https://github.com/test/repo",
          }),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });
  });

  describe("State Encoding and Decoding", () => {
    test("should encode state with all required fields", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockGetUserAppTokens.mockResolvedValue(null);

      const repositoryUrl = "https://github.com/test/repo";

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/install",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            repositoryUrl,
          }),
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      const decodedState = JSON.parse(
        Buffer.from(data.data.state, "base64").toString()
      );

      expect(decodedState).toMatchObject({
        workspaceSlug: workspace.slug,
        repositoryUrl,
        randomState: expect.any(String),
        timestamp: expect.any(Number),
      });

      // Verify timestamp is recent (within last minute)
      const now = Date.now();
      expect(decodedState.timestamp).toBeGreaterThan(now - 60000);
      expect(decodedState.timestamp).toBeLessThanOrEqual(now);
    });
  });
});