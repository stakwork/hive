import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectError,
  getMockedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestRepository } from "@/__tests__/support/fixtures/repository";

// Mock dependencies
vi.mock("next-auth/next");

vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn(),
}));

vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

// Import mocked modules
import { WebhookService } from "@/services/github/WebhookService";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import { getServiceConfig } from "@/config/services";

// Helper to create POST request
function createPostRequest(url: string, body: object): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GitHub Webhook Ensure API Integration Tests - POST /api/github/webhook/ensure", () => {
  const webhookUrl = "http://localhost:3000/api/github/webhook/ensure";

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(getGithubWebhookCallbackUrl).mockReturnValue(
      "https://app.example.com/api/github/webhook"
    );

    vi.mocked(getServiceConfig).mockReturnValue({
      baseURL: "https://api.github.com",
      apiKey: "",
      timeout: 10000,
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(webhookUrl, {
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Unauthorized");
      expect(WebhookService).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Unauthorized");
    });

    test("should return 401 when session.user.id is missing", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Unauthorized");
    });

    test("should proceed with valid authenticated session", async () => {
      const user = await createTestUser({ name: "Test User" });
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock successful webhook creation
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456789,
          secret: "webhook_secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    let user: Awaited<ReturnType<typeof createTestUser>>;

    beforeEach(async () => {
      user = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
    });

    test("should return 400 when workspaceId is missing", async () => {
      const request = createPostRequest(webhookUrl, {
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
      expect(WebhookService).not.toHaveBeenCalled();
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const request = createPostRequest(webhookUrl, {
        workspaceId: "workspace-123",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
    });

    test("should return 400 for empty workspaceId string", async () => {
      const request = createPostRequest(webhookUrl, {
        workspaceId: "",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
    });

    test("should return 400 when both repositoryUrl and repositoryId are null", async () => {
      const request = createPostRequest(webhookUrl, {
        workspaceId: "workspace-123",
        repositoryUrl: null,
        repositoryId: null,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields: workspaceId and repositoryUrl or repositoryId");
    });

    test("should accept request with workspaceId and repositoryUrl", async () => {
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456789,
          secret: "webhook_secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should accept request with workspaceId and repositoryId", async () => {
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 987654321,
          secret: "webhook_secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: repository.repositoryUrl,
        })
      );
    });
  });

  describe("Repository Lookup", () => {
    let user: Awaited<ReturnType<typeof createTestUser>>;

    beforeEach(async () => {
      user = await createTestUser({ name: "Test User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
    });

    test("should return 404 when repository is not found by repositoryId", async () => {
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryId: "nonexistent-repo-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository not found for workspace");
      expect(WebhookService).not.toHaveBeenCalled();
    });

    test("should return 404 when repository workspace does not match provided workspaceId", async () => {
      const ownerWorkspace = await createTestWorkspace({
        name: "Owner Workspace",
        ownerId: user.id,
      });

      const otherUser = await createTestUser({ name: "Other User" });
      const otherWorkspace = await createTestWorkspace({
        name: "Other Workspace",
        ownerId: otherUser.id,
      });

      const repository = await createTestRepository({
        workspaceId: otherWorkspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: ownerWorkspace.id, // Different workspace
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository not found for workspace");
      expect(WebhookService).not.toHaveBeenCalled();
    });

    test("should return 400 when repository lookup returns empty repositoryUrl", async () => {
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      // Create repository with empty URL (edge case)
      const repository = await db.repository.create({
        data: {
          id: generateUniqueId("repo"),
          name: "Test Repository",
          repositoryUrl: "", // Empty URL
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository URL not found");
    });

    test("should successfully lookup repository by repositoryId and use its URL", async () => {
      const workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });

      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/owner/found-repo",
      });

      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 111222333,
          secret: "webhook_secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: "https://github.com/owner/found-repo",
        })
      );
    });
  });

  describe("Webhook Setup", () => {
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

    beforeEach(async () => {
      user = await createTestUser({ name: "Test User" });
      workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
    });

    test("should call WebhookService.ensureRepoWebhook with correct parameters", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456789,
          secret: "webhook_secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(WebhookService).toHaveBeenCalledWith({
        baseURL: "https://api.github.com",
        apiKey: "",
        timeout: 10000,
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      });

      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
        callbackUrl: "https://app.example.com/api/github/webhook",
      });
    });

    test("should return webhookId on successful webhook creation", async () => {
      const webhookId = 987654321;
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: webhookId,
          secret: "webhook_secret_abc123",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);
    });

    test("should generate callback URL correctly", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(getGithubWebhookCallbackUrl).toHaveBeenCalledWith(request);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: "https://app.example.com/api/github/webhook",
        })
      );
    });

    test("should retrieve service config for github service", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(getServiceConfig).toHaveBeenCalledWith("github");
    });
  });

  describe("Error Handling", () => {
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

    beforeEach(async () => {
      user = await createTestUser({ name: "Test User" });
      workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
    });

    test("should return 500 when WebhookService throws INSUFFICIENT_PERMISSIONS error", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi
          .fn()
          .mockRejectedValue(new Error("INSUFFICIENT_PERMISSIONS")),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should return 500 when WebhookService throws WEBHOOK_CREATION_FAILED error", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi
          .fn()
          .mockRejectedValue(new Error("WEBHOOK_CREATION_FAILED")),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should return 500 when WebhookService throws generic error", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi
          .fn()
          .mockRejectedValue(new Error("Network error")),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should return 500 when getGithubWebhookCallbackUrl throws error", async () => {
      vi.mocked(getGithubWebhookCallbackUrl).mockImplementation(() => {
        throw new Error("URL generation failed");
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should return 500 when getServiceConfig throws error", async () => {
      vi.mocked(getServiceConfig).mockImplementation(() => {
        throw new Error("Service config not found");
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should log error to console when exception occurs", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const testError = new Error("Test error for logging");

      vi.mocked(getServiceConfig).mockImplementation(() => {
        throw testError;
      });

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(testError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    let user: Awaited<ReturnType<typeof createTestUser>>;
    let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

    beforeEach(async () => {
      user = await createTestUser({ name: "Test User" });
      workspace = await createTestWorkspace({
        name: "Test Workspace",
        ownerId: user.id,
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
    });

    test("should handle very long workspace IDs", async () => {
      const longWorkspaceId = "workspace-" + "a".repeat(1000);
      
      // Create workspace with long ID
      const longIdWorkspace = await db.workspace.create({
        data: {
          id: longWorkspaceId,
          name: "Long ID Workspace",
          slug: generateUniqueId("long-slug"),
          ownerId: user.id,
        },
      });

      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: longIdWorkspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: longIdWorkspace.id,
        })
      );
    });

    test("should handle special characters in repository URL", async () => {
      const specialRepoUrl =
        "https://github.com/org-name/repo-name-with-special-chars_123";

      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: specialRepoUrl,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: specialRepoUrl,
        })
      );
    });

    test("should handle malformed JSON in request body", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Failed to ensure webhook");
    });

    test("should handle request with extra unexpected fields", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 123456,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
        unexpectedField: "unexpected-value",
        anotherField: 12345,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalled();
    });

    test("should handle webhook service returning webhookId of 0", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: 0,
          secret: "secret",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.data.webhookId).toBe(0);
    });
  });

  describe("End-to-End Webhook Setup Flow", () => {
    test("should complete full webhook setup flow with repositoryUrl", async () => {
      const user = await createTestUser({ name: "E2E Test User" });
      const workspace = await createTestWorkspace({
        name: "E2E Test Workspace",
        ownerId: user.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const webhookId = 555666777;
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: webhookId,
          secret: "webhook_secret_e2e",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/e2e-org/e2e-repo",
      });

      const response = await POST(request);

      // Verify all services were called in correct order
      expect(getMockedSession()).toHaveBeenCalled();
      expect(getGithubWebhookCallbackUrl).toHaveBeenCalled();
      expect(getServiceConfig).toHaveBeenCalledWith("github");
      expect(WebhookService).toHaveBeenCalled();
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/e2e-org/e2e-repo",
        callbackUrl: "https://app.example.com/api/github/webhook",
      });

      // Verify response
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);
    });

    test("should complete full webhook setup flow with repositoryId", async () => {
      const user = await createTestUser({ name: "E2E Test User 2" });
      const workspace = await createTestWorkspace({
        name: "E2E Test Workspace 2",
        ownerId: user.id,
      });

      const repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/e2e-org/e2e-repo-2",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const webhookId = 888999000;
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue({
          id: webhookId,
          secret: "webhook_secret_e2e_2",
        }),
      };
      vi.mocked(WebhookService).mockImplementation(() => mockInstance as any);

      const request = createPostRequest(webhookUrl, {
        workspaceId: workspace.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      // Verify repository lookup was performed
      const foundRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });
      expect(foundRepo).toBeTruthy();
      expect(foundRepo?.repositoryUrl).toBe(
        "https://github.com/e2e-org/e2e-repo-2"
      );

      // Verify webhook service was called with looked-up URL
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: repository.repositoryUrl,
        })
      );

      // Verify response
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(webhookId);
    });
  });
});