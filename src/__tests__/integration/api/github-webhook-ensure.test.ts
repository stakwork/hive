import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock NextAuth session
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock getGithubUsernameAndPAT and authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
  authOptions: {},
}));

describe("POST /api/github/webhook/ensure - Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();
  const mockFetch = vi.fn();

  // Test data factories
  const TestDataFactory = {
    createWorkspace: async (ownerId: string) => {
      return await db.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          slug: generateUniqueSlug("test-workspace"),
          name: "Test Workspace",
          ownerId,
        },
      });
    },

    createRepository: async (workspaceId: string, overrides: Record<string, any> = {}) => {
      return await db.repository.create({
        data: {
          id: generateUniqueId("repo"),
          name: "test-repo",
          repositoryUrl: overrides.repositoryUrl || "https://github.com/test-org/test-repo",
          workspaceId,
          branch: "main",
          status: "SYNCED",
          ...overrides,
        },
      });
    },

    createGitHubAccount: async (userId: string) => {
      const accessToken = "github_pat_test_token_" + generateUniqueId();
      const encryptedToken = encryptionService.encryptField("access_token", accessToken);

      return await db.account.create({
        data: {
          id: generateUniqueId("account"),
          userId,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          access_token: JSON.stringify(encryptedToken),
          scope: "read:user,repo,admin:repo_hook",
        },
      });
    },

    createGitHubAuth: async (userId: string) => {
      return await db.gitHubAuth.create({
        data: {
          userId,
          githubUserId: generateUniqueId(),
          githubUsername: "testuser",
          githubNodeId: "U_test123",
          name: "Test User",
          publicRepos: 5,
          followers: 10,
          following: 5,
          accountType: "User",
        },
      });
    },

    createMockRequest: (body: Record<string, any>) => {
      return new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
  };

  // GitHub API mock helpers
  const GitHubMockHelpers = {
    mockGithubAuth: () => {
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test_token",
      });
    },

    mockSuccessfulWebhookCreation: (webhookId: number = 123456789) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: webhookId,
            config: { url: "https://app.example.com/api/github/webhook" },
            events: ["push", "pull_request"],
            active: true,
          },
        ],
      });
    },

    mockWebhookAlreadyExists: (existingWebhookId: number = 987654321) => {
      // Mock listHooks response with existing webhook
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: existingWebhookId,
            config: { url: "http://localhost:3000/api/github/webhook" },
            events: ["push", "pull_request"],
            active: true,
          },
        ],
      });

      // Mock updateHook response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: existingWebhookId,
          config: { url: "http://localhost:3000/api/github/webhook" },
          events: ["push", "pull_request"],
          active: true,
        }),
      });
    },

    mockWebhookCreationFromScratch: (webhookId: number = 555666777) => {
      // Mock listHooks response with no existing webhooks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      // Mock createHook response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: webhookId,
          config: { url: "http://localhost:3000/api/github/webhook" },
          events: ["push", "pull_request"],
          active: true,
        }),
      });
    },

    mockInsufficientPermissions: () => {
      // Mock listHooks with 403 Forbidden
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({
          message: "Must have admin rights to Repository.",
        }),
      });
    },

    mockRepositoryNotFound: () => {
      // Mock listHooks with 404 Not Found
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({
          message: "Not Found",
        }),
      });
    },

    mockNetworkError: () => {
      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));
    },
  };

  // Assertion helpers
  const AssertionHelpers = {
    expectSuccess: async (response: Response) => {
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.webhookId).toBeDefined();
      return data;
    },

    expectUnauthorized: async (response: Response) => {
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    },

    expectValidationError: async (response: Response, expectedMessage: string) => {
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe(expectedMessage);
    },

    expectNotFound: async (response: Response) => {
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    },

    expectServerError: async (response: Response) => {
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    },

    verifyWebhookPersistence: async (repositoryId: string) => {
      const repository = await db.repository.findUnique({
        where: { id: repositoryId },
        select: { githubWebhookId: true, githubWebhookSecret: true },
      });

      expect(repository).toBeDefined();
      expect(repository!.githubWebhookId).toBeDefined();
      expect(repository!.githubWebhookSecret).toBeDefined();

      // Verify secret is encrypted
      const secretData = JSON.parse(repository!.githubWebhookSecret as string);
      expect(secretData).toHaveProperty("data");
      expect(secretData).toHaveProperty("iv");
      expect(secretData).toHaveProperty("tag");

      // Verify decryption works
      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        repository!.githubWebhookSecret
      );
      expect(decryptedSecret).toBeTruthy();
      expect(typeof decryptedSecret).toBe("string");

      return { repository, decryptedSecret };
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as any;
  });

  afterEach(async () => {
    // Clean up test data
    await db.repository.deleteMany({
      where: { name: { startsWith: "test-repo" } },
    });
    await db.workspace.deleteMany({
      where: { slug: { startsWith: "test-workspace" } },
    });
    await db.gitHubAuth.deleteMany({
      where: { githubUsername: "testuser" },
    });
    await db.account.deleteMany({
      where: { provider: "github" },
    });
    await db.user.deleteMany({
      where: { email: { startsWith: "test-" } },
    });
  });

  describe("Webhook Creation", () => {
    test("should successfully create webhook with real database persistence", async () => {
      // Setup: Create user, workspace, repository, and GitHub account
      const testUser = await createTestUser({ name: "Test User Webhook" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      // Mock authenticated session
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();
      GitHubMockHelpers.mockGithubAuth();

      // Mock GitHub API - no existing webhooks, create new one
      GitHubMockHelpers.mockWebhookCreationFromScratch(555666777);

      // Execute
      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      // Verify response
      const data = await AssertionHelpers.expectSuccess(response);
      expect(data.data.webhookId).toBe(555666777);

      // Verify database persistence
      const { repository: updatedRepo, decryptedSecret } =
        await AssertionHelpers.verifyWebhookPersistence(repository.id);

      expect(updatedRepo!.githubWebhookId).toBe("555666777");
      expect(decryptedSecret).toHaveLength(64); // 32 bytes hex = 64 characters

      // Verify GitHub API was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(2); // listHooks + createHook
    });

    test("should handle webhook creation with repositoryId lookup", async () => {
      const testUser = await createTestUser({ name: "Test User Repo Lookup" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id, {
        repositoryUrl: "https://github.com/org/special-repo",
      });
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();
      GitHubMockHelpers.mockWebhookCreationFromScratch(888999000);

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });
      const response = await POST(request);

      const data = await AssertionHelpers.expectSuccess(response);
      expect(data.data.webhookId).toBe(888999000);

      await AssertionHelpers.verifyWebhookPersistence(repository.id);
    });

    test("should encrypt webhook secret before storing in database", async () => {
      const testUser = await createTestUser({ name: "Test User Encryption" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();
      GitHubMockHelpers.mockWebhookCreationFromScratch();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      await POST(request);

      // Verify encryption format
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      const secretData = JSON.parse(updatedRepo!.githubWebhookSecret as string);
      expect(secretData.data).toBeTruthy();
      expect(secretData.iv).toBeTruthy();
      expect(secretData.tag).toBeTruthy();
      expect(secretData.version).toBe("1");

      // Verify decryption produces valid secret
      const decrypted = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo!.githubWebhookSecret
      );
      expect(decrypted).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    });
  });

  describe("Idempotency", () => {
    test("should update existing webhook instead of creating duplicate", async () => {
      const testUser = await createTestUser({ name: "Test User Idempotent" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // First call: Create webhook
      GitHubMockHelpers.mockWebhookCreationFromScratch(111222333);

      const request1 = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response1 = await POST(request1);
      const data1 = await AssertionHelpers.expectSuccess(response1);
      expect(data1.data.webhookId).toBe(111222333);

      // Verify webhook was created in database
      const repo1 = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo1!.githubWebhookId).toBe("111222333");
      const secret1 = repo1!.githubWebhookSecret;

      // Second call: Should find existing webhook and update it
      GitHubMockHelpers.mockWebhookAlreadyExists(111222333);

      const request2 = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response2 = await POST(request2);
      const data2 = await AssertionHelpers.expectSuccess(response2);

      // Should return same webhook ID
      expect(data2.data.webhookId).toBe(111222333);

      // Verify database still has same webhook ID
      const repo2 = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo2!.githubWebhookId).toBe("111222333");

      // Secret should remain the same (idempotent)
      expect(repo2!.githubWebhookSecret).toBe(secret1);
    });

    test("should reuse existing secret when webhook already exists", async () => {
      const testUser = await createTestUser({ name: "Test User Secret Reuse" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);

      // Pre-populate repository with existing webhook and secret
      const existingSecret = encryptionService.encryptField(
        "githubWebhookSecret",
        "existing_secret_12345678901234567890123456789012"
      );
      const repository = await TestDataFactory.createRepository(workspace.id, {
        githubWebhookId: "999888777",
        githubWebhookSecret: JSON.stringify(existingSecret),
      });

      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock existing webhook found
      GitHubMockHelpers.mockWebhookAlreadyExists(999888777);

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectSuccess(response);

      // Verify secret was NOT regenerated
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(updatedRepo!.githubWebhookSecret).toBe(JSON.stringify(existingSecret));

      // Verify decryption still works
      const decrypted = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo!.githubWebhookSecret
      );
      expect(decrypted).toBe("existing_secret_12345678901234567890123456789012");
    });

    test("should handle multiple rapid webhook ensure calls", async () => {
      const testUser = await createTestUser({ name: "Test User Rapid Calls" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock webhook creation for first call
      GitHubMockHelpers.mockWebhookCreationFromScratch(444555666);

      const request1 = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });

      // Execute first call
      const response1 = await POST(request1);
      await AssertionHelpers.expectSuccess(response1);

      // Mock webhook already exists for subsequent calls
      GitHubMockHelpers.mockWebhookAlreadyExists(444555666);
      GitHubMockHelpers.mockWebhookAlreadyExists(444555666);

      // Execute rapid subsequent calls with new request objects
      const request2 = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const request3 = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });

      const response2 = await POST(request2);
      const response3 = await POST(request3);

      await AssertionHelpers.expectSuccess(response2);
      await AssertionHelpers.expectSuccess(response3);

      // Verify only one webhook record exists
      const finalRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(finalRepo!.githubWebhookId).toBe("444555666");
    });
  });

  describe("Error Handling with GitHub API", () => {
    test("should return 500 when GitHub returns 403 Forbidden (insufficient permissions)", async () => {
      const testUser = await createTestUser({ name: "Test User Forbidden" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock GitHub API 403 error
      GitHubMockHelpers.mockInsufficientPermissions();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectServerError(response);

      // Verify webhook was NOT persisted to database
      const repo = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo!.githubWebhookId).toBeNull();
      expect(repo!.githubWebhookSecret).toBeNull();
    });

    test("should return 500 when GitHub returns 404 Not Found", async () => {
      const testUser = await createTestUser({ name: "Test User Not Found" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id, {
        repositoryUrl: "https://github.com/nonexistent/repo",
      });
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock GitHub API 404 error
      GitHubMockHelpers.mockRepositoryNotFound();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectServerError(response);

      // Verify no webhook data persisted
      const repo = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo!.githubWebhookId).toBeNull();
      expect(repo!.githubWebhookSecret).toBeNull();
    });

    test("should return 500 when GitHub API network request fails", async () => {
      const testUser = await createTestUser({ name: "Test User Network Error" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock network error
      GitHubMockHelpers.mockNetworkError();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectServerError(response);

      // Verify database remains unchanged
      const repo = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo!.githubWebhookId).toBeNull();
    });

    test("should handle webhook creation failure after successful list", async () => {
      const testUser = await createTestUser({ name: "Test User Create Fail" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock successful listHooks but failed createHook
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({
            message: "Validation Failed",
            errors: [{ message: "Hook already exists on this repository" }],
          }),
        });

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectServerError(response);
    });
  });

  describe("Authentication and Authorization", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = TestDataFactory.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      const response = await POST(request);

      await AssertionHelpers.expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when repository does not belong to workspace", async () => {
      const testUser = await createTestUser({ name: "Test User Wrong Workspace" });
      const workspace1 = await TestDataFactory.createWorkspace(testUser.id);
      const workspace2 = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace2.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace1.id, // Different workspace
        repositoryId: repository.id,
      });
      const response = await POST(request);

      await AssertionHelpers.expectNotFound(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when user has no GitHub account", async () => {
      const testUser = await createTestUser({ name: "Test User No GitHub" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      // Should fail when trying to get GitHub token
      await AssertionHelpers.expectServerError(response);
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      const testUser = await createTestUser({ name: "Test User No Workspace ID" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      const request = TestDataFactory.createMockRequest({
        repositoryUrl: "https://github.com/test-org/test-repo",
      });
      const response = await POST(request);

      await AssertionHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const testUser = await createTestUser({ name: "Test User No Repo" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      const request = TestDataFactory.createMockRequest({
        workspaceId: "workspace-123",
      });
      const response = await POST(request);

      await AssertionHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });

    test("should return 404 when repository does not exist", async () => {
      const testUser = await createTestUser({ name: "Test User Nonexistent Repo" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryId: "nonexistent-repo-id",
      });
      const response = await POST(request);

      await AssertionHelpers.expectNotFound(response);
    });
  });

  describe("Database Integration", () => {
    test("should verify webhook persistence with correct encryption format", async () => {
      const testUser = await createTestUser({ name: "Test User DB Persistence" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();
      GitHubMockHelpers.mockWebhookCreationFromScratch(777888999);

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      await POST(request);

      // Verify database record
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepo!.githubWebhookId).toBe("777888999");
      expect(updatedRepo!.githubWebhookSecret).toBeTruthy();

      // Verify encryption structure
      const secretData = JSON.parse(updatedRepo!.githubWebhookSecret as string);
      expect(secretData).toMatchObject({
        data: expect.any(String),
        iv: expect.any(String),
        tag: expect.any(String),
        version: "1",
      });

      // Verify decryption works
      const decrypted = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo!.githubWebhookSecret
      );
      expect(decrypted).toHaveLength(64); // 32 bytes hex
    });

    test("should handle database transaction rollback on encryption failure", async () => {
      const testUser = await createTestUser({ name: "Test User Encryption Fail" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();
      GitHubMockHelpers.mockWebhookCreationFromScratch();

      // Temporarily break encryption by mocking encryptField to throw
      const originalEncrypt = encryptionService.encryptField;
      vi.spyOn(encryptionService, "encryptField").mockImplementation(() => {
        throw new Error("Encryption service unavailable");
      });

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });

      const response = await POST(request);
      await AssertionHelpers.expectServerError(response);

      // Verify database was not modified
      const repo = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo!.githubWebhookId).toBeNull();
      expect(repo!.githubWebhookSecret).toBeNull();

      // Restore original encryption
      vi.spyOn(encryptionService, "encryptField").mockImplementation(originalEncrypt);
    });

    test("should clean up database on partial webhook creation failure", async () => {
      const testUser = await createTestUser({ name: "Test User Cleanup" });
      const workspace = await TestDataFactory.createWorkspace(testUser.id);
      const repository = await TestDataFactory.createRepository(workspace.id);
      await TestDataFactory.createGitHubAccount(testUser.id);
      await TestDataFactory.createGitHubAuth(testUser.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      GitHubMockHelpers.mockGithubAuth();

      // Mock successful listHooks but network error on createHook
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        })
        .mockRejectedValueOnce(new Error("Connection timeout"));

      const request = TestDataFactory.createMockRequest({
        workspaceId: workspace.id,
        repositoryUrl: repository.repositoryUrl,
      });
      const response = await POST(request);

      await AssertionHelpers.expectServerError(response);

      // Verify database remains in consistent state (no partial updates)
      const repo = await db.repository.findUnique({ where: { id: repository.id } });
      expect(repo!.githubWebhookId).toBeNull();
      expect(repo!.githubWebhookSecret).toBeNull();
    });
  });
});