import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth";
import { NextRequest } from "next/server";
import {
  createTestRepository,
} from "@/__tests__/support/fixtures/github-webhook";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock external services only
vi.mock("@/lib/auth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
  authOptions: {},
}));

// Mock next-auth session
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";

describe("GitHub Webhook Ensure Integration Tests - POST /api/github/webhook/ensure", () => {
  const endpointUrl = "http://localhost:3000/api/github/webhook/ensure";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create authenticated request
  const createAuthenticatedRequest = (body: object, userId: string = "user-123") => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: "test@example.com", name: "Test User" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });

    return new NextRequest(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  // Helper to create unauthenticated request
  const createUnauthenticatedRequest = (body: object) => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    return new NextRequest(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  // Helper to mock GitHub API calls
  const mockGitHubAPI = {
    mockSuccessfulWebhookCreation: (webhookId: number = 123456789) => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url, options) => {
        const urlStr = url.toString();
        
        // Mock verifyHookExists (GET /repos/{owner}/{repo}/hooks/{hookId})
        if (options?.method === "GET" && urlStr.includes("/hooks/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: webhookId }), {
              status: 404, // Webhook doesn't exist, need to create
            })
          );
        }
        
        // Mock createHook (POST /repos/{owner}/{repo}/hooks)
        if (options?.method === "POST" && urlStr.includes("/hooks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: webhookId }), {
              status: 201,
            })
          );
        }
        
        return originalFetch(url, options);
      }) as typeof global.fetch;
    },

    mockExistingWebhook: (webhookId: number = 123456789) => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url, options) => {
        const urlStr = url.toString();
        
        // Mock verifyHookExists - webhook exists
        if (options?.method === "GET" && urlStr.includes("/hooks/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: webhookId }), {
              status: 200, // Webhook exists
            })
          );
        }
        
        return originalFetch(url, options);
      }) as typeof global.fetch;
    },

    mockInsufficientPermissions: () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url, options) => {
        const urlStr = url.toString();
        
        if (options?.method === "POST" && urlStr.includes("/hooks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: "Forbidden" }), {
              status: 403,
            })
          );
        }
        
        return originalFetch(url, options);
      }) as typeof global.fetch;
    },

    mockGitHubAPIError: () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url, options) => {
        const urlStr = url.toString();
        
        if (urlStr.includes("/hooks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ message: "Internal Server Error" }), {
              status: 500,
            })
          );
        }
        
        return originalFetch(url, options);
      }) as typeof global.fetch;
    },
  };

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const { repository } = await createTestRepository();

      const request = createUnauthenticatedRequest({
        workspaceId: repository.workspaceId,
        repositoryUrl: repository.repositoryUrl,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        success: false,
        message: "Unauthorized",
      });
    });

    test("should proceed with valid authentication", async () => {
      const { repository, workspace } = await createTestRepository();
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockSuccessfulWebhookCreation(111222333);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      const request = createAuthenticatedRequest({
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields");
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const request = createAuthenticatedRequest({
        workspaceId: "workspace-123",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields");
    });

    test("should accept request with repositoryUrl", async () => {
      const { repository, workspace } = await createTestRepository();
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockSuccessfulWebhookCreation();

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should accept request with repositoryId", async () => {
      const { repository, workspace } = await createTestRepository();
      
      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockSuccessfulWebhookCreation();

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryId: repository.id,
        },
        workspace.ownerId
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Repository Lookup and Workspace Authorization", () => {
    test("should return 404 when repository is not found by repositoryId", async () => {
      const { workspace } = await createTestRepository();

      const request = createAuthenticatedRequest(
        {
          workspaceId: workspace.id,
          repositoryId: "nonexistent-repo-id",
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Repository not found for workspace");
    });

    test("should return 404 when repository workspace does not match provided workspaceId", async () => {
      const { repository, workspace } = await createTestRepository();
      
      // Create another workspace
      const differentWorkspace = await db.workspace.create({
        data: {
          name: "Different Workspace",
          slug: `different-workspace-${Date.now()}`,
          ownerId: workspace.ownerId,
        },
      });

      const request = createAuthenticatedRequest(
        {
          workspaceId: differentWorkspace.id,
          repositoryId: repository.id,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Repository not found for workspace");
    });
  });

  describe("Webhook Creation with Database Persistence", () => {
    test("should create webhook and persist to database with encryption", async () => {
      const { repository, workspace } = await createTestRepository({
        // Repository without webhook initially
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });
      
      // Directly update to remove webhook data
      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      const webhookId = 987654321;
      mockGitHubAPI.mockSuccessfulWebhookCreation(webhookId);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);

      // Verify database persistence
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepo).toBeTruthy();
      expect(updatedRepo?.githubWebhookId).toBe(String(webhookId));
      expect(updatedRepo?.githubWebhookSecret).toBeTruthy();

      // Verify encryption
      const encryptionService = EncryptionService.getInstance();
      const decryptedSecret = encryptionService.decryptField(
        "githubWebhookSecret",
        updatedRepo!.githubWebhookSecret!
      );
      
      expect(decryptedSecret).toBeTruthy();
      expect(typeof decryptedSecret).toBe("string");
      expect(decryptedSecret.length).toBe(64); // 32 bytes hex = 64 chars
    });

    test("should reuse existing webhook when already configured", async () => {
      const existingWebhookId = 123456789;
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: String(existingWebhookId),
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockExistingWebhook(existingWebhookId);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(existingWebhookId);

      // Verify no new webhook was created in database
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(unchangedRepo?.githubWebhookId).toBe(String(existingWebhookId));
    });

    test("should create new webhook when existing one is deleted from GitHub", async () => {
      const oldWebhookId = "old-webhook-456";
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: oldWebhookId,
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      const newWebhookId = 999888777;
      mockGitHubAPI.mockSuccessfulWebhookCreation(newWebhookId);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.webhookId).toBe(newWebhookId);

      // Verify database was updated with new webhook
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepo?.githubWebhookId).toBe(String(newWebhookId));
    });
  });

  describe("GitHub API Error Handling", () => {
    test("should return 500 when GitHub API returns insufficient permissions error", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockInsufficientPermissions();

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    });

    test("should return 500 when GitHub API returns server error", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockGitHubAPIError();

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    test("should return 500 when getGithubUsernameAndPAT returns no credentials", async () => {
      const { repository, workspace } = await createTestRepository();

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    });
  });

  describe("Encryption Integration", () => {
    test("should properly encrypt webhook secret for storage", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockSuccessfulWebhookCreation(555666777);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      await POST(request);

      // Verify secret is stored encrypted
      const storedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(storedRepo?.githubWebhookSecret).toBeTruthy();
      
      // Encrypted secret should be JSON string containing encryption metadata
      const encryptedData = JSON.parse(storedRepo!.githubWebhookSecret!);
      expect(encryptedData).toHaveProperty("data");
      expect(encryptedData).toHaveProperty("iv");
      expect(encryptedData).toHaveProperty("tag");
      expect(encryptedData).toHaveProperty("version");
    });

    test("should properly decrypt webhook secret when reusing existing webhook", async () => {
      const plainSecret = "original_webhook_secret_123456789abcdef0";
      const encryptionService = EncryptionService.getInstance();
      const encrypted = encryptionService.encryptField("githubWebhookSecret", plainSecret);

      const { repository, workspace } = await createTestRepository({
        githubWebhookId: "webhook-888",
        webhookSecret: null as any, // Will set manually
      });

      // Manually set encrypted secret
      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: "webhook-888",
          githubWebhookSecret: JSON.stringify(encrypted),
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      mockGitHubAPI.mockExistingWebhook(888);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);

      // Endpoint should successfully decrypt and reuse webhook
      expect(response.status).toBe(200);

      // Verify stored secret remains unchanged
      const unchangedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      const decrypted = encryptionService.decryptField(
        "githubWebhookSecret",
        unchangedRepo!.githubWebhookSecret!
      );

      expect(decrypted).toBe(plainSecret);
    });
  });

  describe("Complete Integration Scenarios", () => {
    test("should complete full webhook setup flow with repositoryUrl", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "integration-test-user",
        token: "github_pat_integration",
      });

      const webhookId = 123123123;
      mockGitHubAPI.mockSuccessfulWebhookCreation(webhookId);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);

      // Verify database state
      const finalRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(finalRepo?.githubWebhookId).toBe(String(webhookId));
      expect(finalRepo?.githubWebhookSecret).toBeTruthy();

      // Verify encryption roundtrip
      const encryptionService = EncryptionService.getInstance();
      const decrypted = encryptionService.decryptField(
        "githubWebhookSecret",
        finalRepo!.githubWebhookSecret!
      );

      expect(decrypted).toBeTruthy();
      expect(decrypted.length).toBe(64);
    });

    test("should complete full webhook setup flow with repositoryId", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "integration-test-user",
        token: "github_pat_integration",
      });

      const webhookId = 456456456;
      mockGitHubAPI.mockSuccessfulWebhookCreation(webhookId);

      const request = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryId: repository.id,
        },
        workspace.ownerId
      );

      const response = await POST(request);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);

      // Verify repository lookup was performed correctly
      const finalRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(finalRepo?.workspaceId).toBe(repository.workspaceId);
      expect(finalRepo?.githubWebhookId).toBe(String(webhookId));
    });

    test("should handle multiple sequential webhook ensure calls idempotently", async () => {
      const { repository, workspace } = await createTestRepository({
        githubWebhookId: null as any,
        webhookSecret: null as any,
      });

      await db.repository.update({
        where: { id: repository.id },
        data: {
          githubWebhookId: null,
          githubWebhookSecret: null,
        },
      });

      vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      const webhookId = 789789789;

      // First call - create webhook
      mockGitHubAPI.mockSuccessfulWebhookCreation(webhookId);

      const request1 = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response1 = await POST(request1);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.data.webhookId).toBe(webhookId);

      // Second call - reuse existing webhook
      mockGitHubAPI.mockExistingWebhook(webhookId);

      const request2 = createAuthenticatedRequest(
        {
          workspaceId: repository.workspaceId,
          repositoryUrl: repository.repositoryUrl,
        },
        workspace.ownerId
      );

      const response2 = await POST(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.data.webhookId).toBe(webhookId);

      // Verify webhook ID didn't change
      const finalRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(finalRepo?.githubWebhookId).toBe(String(webhookId));
    });
  });
});
