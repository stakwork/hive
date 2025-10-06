import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { WebhookService } from "@/services/github/WebhookService";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock next-auth
vi.mock("next-auth/next");

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    repository: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    user: {
      create: vi.fn().mockImplementation((data) => 
        Promise.resolve({
          id: generateUniqueId("user"),
          ...data.data,
          role: "USER",
          emailVerified: null,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock WebhookService
vi.mock("@/services/github/WebhookService");

// Mock URL utilities
vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(),
}));

// Mock service config
vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({
    baseURL: "https://api.github.com",
    apiKey: "",
    timeout: 10000,
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  })),
}));

describe("POST /api/github/webhook/ensure", () => {
  const mockWorkspaceId = generateUniqueId("workspace");
  const mockRepositoryUrl = "https://github.com/test-org/test-repo";
  const mockCallbackUrl = "https://example.com/api/github/webhook";
  const mockWebhookId = 123456789;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGithubWebhookCallbackUrl).mockReturnValue(mockCallbackUrl);
  });

  describe("Authentication scenarios", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should return 401 when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Request validation scenarios", () => {
    test("should return 400 when workspaceId is missing", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields");
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Missing required fields");
    });

    test("should accept workspaceId with repositoryUrl", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockEnsureRepoWebhook).toHaveBeenCalled();
    });

    test("should accept workspaceId with repositoryId", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: mockRepositoryUrl,
        workspaceId: mockWorkspaceId,
        name: "test-repo",
        branch: "main",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        githubWebhookId: null,
        githubWebhookSecret: null,
        testingFrameworkSetup: false,
        playwrightSetup: false,
      });

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);
    });
  });

  describe("Repository lookup and authorization scenarios", () => {
    test("should return 404 when repository not found by repositoryId", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockResolvedValue(null);

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository not found");
    });

    test("should return 404 when repository belongs to different workspace", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");
      const differentWorkspaceId = generateUniqueId("workspace");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: mockRepositoryUrl,
        workspaceId: differentWorkspaceId,
        name: "test-repo",
        branch: "main",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        githubWebhookId: null,
        githubWebhookSecret: null,
        testingFrameworkSetup: false,
        playwrightSetup: false,
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository not found");
    });

    test("should return 400 when repository URL not found after lookup", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: "",
        workspaceId: mockWorkspaceId,
        name: "test-repo",
        branch: "main",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        githubWebhookId: null,
        githubWebhookSecret: null,
        testingFrameworkSetup: false,
        playwrightSetup: false,
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Repository URL not found");
    });
  });

  describe("Webhook setup scenarios", () => {
    test("should successfully setup webhook with repositoryUrl", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret-32-bytes-hex-string",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: testUser.id,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      });
    });

    test("should successfully setup webhook with repositoryId", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: mockRepositoryId,
        repositoryUrl: mockRepositoryUrl,
        workspaceId: mockWorkspaceId,
        name: "test-repo",
        branch: "main",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        githubWebhookId: null,
        githubWebhookSecret: null,
        testingFrameworkSetup: false,
        playwrightSetup: false,
      });

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret-32-bytes-hex-string",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.webhookId).toBe(mockWebhookId);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: testUser.id,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      });
    });

    test("should pass callback URL to webhook service", async () => {
      const testUser = await createTestUser();
      const customCallbackUrl = "https://custom.example.com/webhook";

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(getGithubWebhookCallbackUrl).mockReturnValue(customCallbackUrl);

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      await POST(request);

      expect(getGithubWebhookCallbackUrl).toHaveBeenCalledWith(request);
      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: customCallbackUrl,
        })
      );
    });
  });

  describe("Error handling scenarios", () => {
    test("should return 500 when WebhookService throws error", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockEnsureRepoWebhook = vi
        .fn()
        .mockRejectedValue(new Error("Webhook creation failed"));
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    });

    test("should return 500 when repository lookup throws error", async () => {
      const testUser = await createTestUser();
      const mockRepositoryId = generateUniqueId("repository");

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(db.repository.findUnique).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryId: mockRepositoryId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    });

    test("should return 500 when getGithubWebhookCallbackUrl throws error", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.mocked(getGithubWebhookCallbackUrl).mockImplementation(() => {
        throw new Error("Failed to generate callback URL");
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to ensure webhook");
    });
  });

  describe("Integration with WebhookService", () => {
    test("should create WebhookService with correct config", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret",
      });
      const mockWebhookServiceConstructor = vi.fn();
      vi.mocked(WebhookService).mockImplementation((config) => {
        mockWebhookServiceConstructor(config);
        return {
          ensureRepoWebhook: mockEnsureRepoWebhook,
        } as any;
      });

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      await POST(request);

      expect(mockWebhookServiceConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "https://api.github.com",
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
          }),
        })
      );
    });

    test("should pass all required parameters to ensureRepoWebhook", async () => {
      const testUser = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const mockEnsureRepoWebhook = vi.fn().mockResolvedValue({
        id: mockWebhookId,
        secret: "test-secret",
      });
      vi.mocked(WebhookService).mockImplementation(() => ({
        ensureRepoWebhook: mockEnsureRepoWebhook,
      } as any));

      const request = createPostRequest(
        "http://localhost:3000/api/github/webhook/ensure",
        {
          workspaceId: mockWorkspaceId,
          repositoryUrl: mockRepositoryUrl,
        }
      );

      await POST(request);

      expect(mockEnsureRepoWebhook).toHaveBeenCalledWith({
        userId: testUser.id,
        workspaceId: mockWorkspaceId,
        repositoryUrl: mockRepositoryUrl,
        callbackUrl: mockCallbackUrl,
      });
    });
  });
});