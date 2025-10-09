import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { NextRequest } from "next/server";

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock getGithubWebhookCallbackUrl
vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(() => "http://localhost:3000/api/github/webhook"),
}));

describe("POST /api/github/webhook/ensure Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestWorkspaceWithRepository(options?: {
    repositoryUrl?: string;
    existingWebhookId?: string;
    existingWebhookSecret?: string;
  }) {
    const {
      repositoryUrl = `https://github.com/test/repo-${generateUniqueId()}`,
      existingWebhookId,
      existingWebhookSecret,
    } = options || {};

    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create GitHub account for user with access token
      const encryptedToken = encryptionService.encryptField("access_token", "gho_test_token_123");
      await tx.account.create({
        data: {
          id: generateUniqueId("test-account"),
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          access_token: JSON.stringify(encryptedToken),
          scope: "read:user,repo",
        },
      });

      // Create GitHub auth record for getUserGithubAccessToken
      await tx.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "testuser",
          githubUsername: "testuser",
          name: testUser.name || "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: `test-workspace-${generateUniqueId()}`,
          ownerId: testUser.id,
        },
      });

      const repositoryData: any = {
        id: generateUniqueId("repository"),
        name: "test-repo",
        repositoryUrl,
        workspaceId: workspace.id,
        branch: "main",
      };

      if (existingWebhookId) {
        repositoryData.githubWebhookId = existingWebhookId;
      }

      if (existingWebhookSecret) {
        const encryptedSecret = encryptionService.encryptField("githubWebhookSecret", existingWebhookSecret);
        repositoryData.githubWebhookSecret = JSON.stringify(encryptedSecret);
      }

      const repository = await tx.repository.create({
        data: repositoryData,
      });

      return { testUser, workspace, repository };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication scenarios", () => {
    test("should return 401 for unauthenticated user", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "workspace-id",
          repositoryUrl: "https://github.com/test/repo",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ success: false, message: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for session without user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "workspace-id",
          repositoryUrl: "https://github.com/test/repo",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ success: false, message: "Unauthorized" });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Request validation scenarios", () => {
    test("should return 400 when workspaceId is missing", async () => {
      const { testUser } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          repositoryUrl: "https://github.com/test/repo",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Missing required fields: workspaceId and repositoryUrl or repositoryId",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const { testUser, workspace } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Missing required fields: workspaceId and repositoryUrl or repositoryId",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should accept repositoryId instead of repositoryUrl", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [], // listHooks - no existing webhooks
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 12345 }), // createHook
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryId: repository.id,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: { webhookId: 12345 },
      });
    });
  });

  describe("Repository lookup and authorization scenarios", () => {
    test("should return 404 when repository not found by repositoryId", async () => {
      const { testUser, workspace } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryId: "non-existent-repo-id",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Repository not found for workspace",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when repository belongs to different workspace", async () => {
      const { testUser, repository } = await createTestWorkspaceWithRepository();

      // Create a different workspace
      const differentWorkspace = await db.workspace.create({
        data: {
          id: generateUniqueId("workspace-2"),
          name: "Different Workspace",
          slug: `different-workspace-${generateUniqueId()}`,
          ownerId: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: differentWorkspace.id, // Different workspace
          repositoryId: repository.id,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Repository not found for workspace",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Successful webhook creation scenarios", () => {
    test("should successfully create new webhook and return webhookId", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [], // listHooks - no existing webhooks
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 12345 }), // createHook
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: { webhookId: 12345 },
      });

      // Verify GitHub API was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(2);
      
      // Verify listHooks call
      const listHooksCall = mockFetch.mock.calls[0];
      expect(listHooksCall[0]).toContain("/repos/test/repo");
      expect(listHooksCall[0]).toContain("/hooks");
      
      // Verify createHook call
      const createHookCall = mockFetch.mock.calls[1];
      expect(createHookCall[0]).toContain("/repos/test/repo");
      expect(createHookCall[0]).toContain("/hooks");
      expect(createHookCall[1]?.method).toBe("POST");

      // Verify database was updated
      const updatedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepository?.githubWebhookId).toBe("12345");
      expect(updatedRepository?.githubWebhookSecret).toBeTruthy();

      // Verify webhook secret is encrypted
      const storedSecret = JSON.parse(updatedRepository!.githubWebhookSecret!);
      expect(storedSecret).toHaveProperty("data");
      expect(storedSecret).toHaveProperty("iv");
      expect(storedSecret).toHaveProperty("tag");
      expect(storedSecret).toHaveProperty("keyId");
    });

    test("should decrypt stored webhook secret successfully", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [], // listHooks
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 12345 }), // createHook
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      await POST(request);

      // Retrieve and decrypt secret
      const updatedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepository!.githubWebhookSecret!
      );

      expect(decryptedSecret).toBeTruthy();
      expect(typeof decryptedSecret).toBe("string");
      expect(decryptedSecret.length).toBeGreaterThan(0);
    });
  });

  describe("Idempotency scenarios", () => {
    test("should return existing webhookId when webhook already exists", async () => {
      const existingWebhookId = "67890";
      const existingSecret = "existing-secret-123";
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository({
        existingWebhookId,
        existingWebhookSecret: existingSecret,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API to return existing webhook
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: parseInt(existingWebhookId),
              config: { url: "http://localhost:3000/api/github/webhook" },
            },
          ], // listHooks - existing webhook found
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: parseInt(existingWebhookId) }), // updateHook
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: { webhookId: parseInt(existingWebhookId) },
      });

      // Verify GitHub API was called to list and update
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify webhook ID unchanged
      const updatedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepository?.githubWebhookId).toBe(existingWebhookId);
    });

    test("should preserve existing secret when updating webhook", async () => {
      const existingWebhookId = "99999";
      const existingSecret = "preserved-secret-456";
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository({
        existingWebhookId,
        existingWebhookSecret: existingSecret,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: parseInt(existingWebhookId),
              config: { url: "http://localhost:3000/api/github/webhook" },
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: parseInt(existingWebhookId) }),
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      await POST(request);

      // Verify secret remains unchanged
      const updatedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepository!.githubWebhookSecret!
      );

      expect(decryptedSecret).toBe(existingSecret);
    });

    test("should not create duplicate webhooks on concurrent requests", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API for multiple concurrent calls
      mockFetch.mockImplementation((url) => {
        if (url.toString().includes("/hooks?")) {
          // listHooks
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [],
          });
        }
        // createHook
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ id: 11111 }),
        });
      });

      const request1 = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const request2 = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      // Execute requests concurrently
      const [response1, response2] = await Promise.all([POST(request1), POST(request2)]);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Verify only one webhook ID in database
      const finalRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(finalRepository?.githubWebhookId).toBeTruthy();
    });
  });

  describe("GitHub API error handling scenarios", () => {
    test("should return 500 when GitHub API returns 403 INSUFFICIENT_PERMISSIONS", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API to return 403
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });

    test("should return 500 when GitHub API returns 404", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API to return 404 (repository not found)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });

    test("should return 500 when GitHub API returns 500", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API to return 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });

    test("should return 500 when GitHub API network error occurs", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API to throw network error
      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });

    test("should handle webhook creation failure gracefully", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API: listHooks succeeds, createHook fails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [], // listHooks - no webhooks
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({ message: "Validation Failed" }),
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });

      // Verify database not updated
      const unchangedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(unchangedRepository?.githubWebhookId).toBeNull();
      expect(unchangedRepository?.githubWebhookSecret).toBeNull();
    });
  });

  describe("Database error scenarios", () => {
    test("should return 500 when workspace not found", async () => {
      const { testUser, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "non-existent-workspace",
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });

    test("should return 500 when repository not found in workspace", async () => {
      const { testUser, workspace } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/non-existent/repo",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Failed to ensure webhook",
      });
    });
  });

  describe("Edge cases and special scenarios", () => {
    test("should handle malformed JSON request body", async () => {
      const { testUser } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: "invalid json {",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });

    test("should handle various GitHub URL formats", async () => {
      const testCases = [
        "https://github.com/owner/repo",
        "https://github.com/owner/repo.git",
        "git@github.com:owner/repo.git",
        "git@github.com:owner/repo",
      ];

      for (const repositoryUrl of testCases) {
        const { testUser, workspace } = await createTestWorkspaceWithRepository({
          repositoryUrl,
        });

        // Create repository with this URL format
        const repository = await db.repository.findFirst({
          where: {
            workspaceId: workspace.id,
            repositoryUrl,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock GitHub API
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [],
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: 12345 }),
          });

        const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
          method: "POST",
          body: JSON.stringify({
            workspaceId: workspace.id,
            repositoryUrl,
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.webhookId).toBe(12345);

        mockFetch.mockClear();
      }
    });

    test("should handle empty request body", async () => {
      const { testUser } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        message: "Missing required fields: workspaceId and repositoryUrl or repositoryId",
      });
    });

    test("should handle webhook secret generation for new webhooks", async () => {
      const { testUser, workspace, repository } = await createTestWorkspaceWithRepository();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock GitHub API
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 54321 }),
        });

      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: workspace.id,
          repositoryUrl: repository.repositoryUrl,
        }),
      });

      await POST(request);

      // Verify secret was generated and encrypted
      const updatedRepository = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepository?.githubWebhookSecret).toBeTruthy();

      // Decrypt and verify secret format (should be hex string)
      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepository!.githubWebhookSecret!
      );

      expect(decryptedSecret).toMatch(/^[a-f0-9]+$/); // Hex string
      expect(decryptedSecret.length).toBe(64); // 32 bytes = 64 hex chars
    });
  });
});