import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/github/webhook/ensure/route";
import { auth } from "@/auth";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    repository: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn(),
}));

vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

// Import mocked modules
import { db } from "@/lib/db";
import { WebhookService } from "@/services/github/WebhookService";
import { getGithubWebhookCallbackUrl } from "@/lib/url";
import { getServiceConfig } from "@/config/services";

const mockGetServerSession = auth as Mock;
const mockDbRepositoryFindUnique = db.repository.findUnique as Mock;
const mockWebhookService = WebhookService as Mock;
const mockGetGithubWebhookCallbackUrl = getGithubWebhookCallbackUrl as Mock;
const mockGetServiceConfig = getServiceConfig as Mock;

// Test Data Factories
const TestDataFactory = {
  createValidSession: () => ({
    user: {
      id: "user-123",
      email: "test@example.com",
      name: "Test User",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }),

  createValidRepository: (overrides = {}) => ({
    id: "repo-123",
    name: "test-repo",
    repositoryUrl: "https://github.com/test-org/test-repo",
    workspaceId: "workspace-123",
    branch: "main",
    status: "SYNCED",
    githubWebhookId: null,
    githubWebhookSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  createWebhookServiceResult: (overrides = {}) => ({
    id: 123456789,
    secret: "webhook_secret_abc123",
    ...overrides,
  }),

  createServiceConfig: () => ({
    baseURL: "https://api.github.com",
    apiKey: "",
    timeout: 10000,
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  }),
};

// Test Helpers
const TestHelpers = {
  createMockRequest: (body: object) => {
    return new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  setupAuthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(TestDataFactory.createValidSession());
  },

  setupUnauthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(null);
  },

  setupSessionWithoutUser: () => {
    mockGetServerSession.mockResolvedValue({ expires: new Date().toISOString() });
  },

  setupSessionWithoutUserId: () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "test@example.com" },
      expires: new Date().toISOString(),
    });
  },

  expectAuthenticationError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({
      success: false,
      message: "Unauthorized",
    });
  },

  expectValidationError: async (response: Response, expectedMessage: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe(expectedMessage);
  },

  expectNotFoundError: async (response: Response, expectedMessage: string) => {
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe(expectedMessage);
  },

  expectSuccessResponse: async (response: Response, expectedWebhookId: number) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      success: true,
      data: {
        webhookId: expectedWebhookId,
      },
    });
  },

  expectServerError: async (response: Response) => {
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({
      success: false,
      message: "Failed to ensure webhook",
    });
  },
};

// Mock Setup Helpers
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulWebhookCreation: (webhookId: number = 123456789) => {
    const mockWebhookServiceInstance = {
      ensureRepoWebhook: vi.fn().mockResolvedValue({
        id: webhookId,
        secret: "webhook_secret_abc123",
      }),
    };

    mockWebhookService.mockImplementation(() => mockWebhookServiceInstance);
    mockGetGithubWebhookCallbackUrl.mockReturnValue("https://app.example.com/api/github/webhook");
    mockGetServiceConfig.mockReturnValue(TestDataFactory.createServiceConfig());

    return mockWebhookServiceInstance;
  },

  setupRepositoryLookup: (repository: any) => {
    mockDbRepositoryFindUnique.mockResolvedValue(repository);
  },
};

describe("POST /api/github/webhook/ensure - Integration Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectAuthenticationError(response);
      expect(mockDbRepositoryFindUnique).not.toHaveBeenCalled();
      expect(mockWebhookService).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      TestHelpers.setupSessionWithoutUser();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should return 401 when session.user.id is missing", async () => {
      TestHelpers.setupSessionWithoutUserId();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should proceed with valid session", async () => {
      TestHelpers.setupAuthenticatedUser();
      MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).not.toBe(401);
      expect(mockGetServerSession).toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 400 when workspaceId is missing", async () => {
      const request = TestHelpers.createMockRequest({
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });

    test("should return 400 when both repositoryUrl and repositoryId are missing", async () => {
      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });

    test("should accept request with workspaceId and repositoryUrl", async () => {
      MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockDbRepositoryFindUnique).not.toHaveBeenCalled();
    });

    test("should accept request with workspaceId and repositoryId", async () => {
      const repository = TestDataFactory.createValidRepository();
      MockSetup.setupRepositoryLookup(repository);
      MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockDbRepositoryFindUnique).toHaveBeenCalledWith({
        where: { id: "repo-123" },
        select: { repositoryUrl: true, workspaceId: true },
      });
    });

    test("should handle null values for repositoryUrl and repositoryId", async () => {
      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: null,
        repositoryId: null,
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });

    test("should handle empty string for workspaceId", async () => {
      const request = TestHelpers.createMockRequest({
        workspaceId: "",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(
        response,
        "Missing required fields: workspaceId and repositoryUrl or repositoryId"
      );
    });
  });

  describe("Repository Lookup", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 404 when repository is not found by repositoryId", async () => {
      MockSetup.setupRepositoryLookup(null);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "nonexistent-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectNotFoundError(
        response,
        "Repository not found for workspace"
      );
      expect(mockWebhookService).not.toHaveBeenCalled();
    });

    test("should return 404 when repository workspace does not match provided workspaceId", async () => {
      const repository = TestDataFactory.createValidRepository({
        workspaceId: "different-workspace-456",
      });
      MockSetup.setupRepositoryLookup(repository);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      await TestHelpers.expectNotFoundError(
        response,
        "Repository not found for workspace"
      );
      expect(mockWebhookService).not.toHaveBeenCalled();
    });

    test("should successfully lookup repository by repositoryId", async () => {
      const repository = TestDataFactory.createValidRepository({
        repositoryUrl: "https://github.com/test-org/found-repo",
      });
      MockSetup.setupRepositoryLookup(repository);
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: "https://github.com/test-org/found-repo",
        })
      );
    });

    test("should return 400 when repositoryId lookup returns empty repositoryUrl", async () => {
      const repository = TestDataFactory.createValidRepository({
        repositoryUrl: "",
      });
      MockSetup.setupRepositoryLookup(repository);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(response, "Repository URL not found");
    });
  });

  describe("Webhook Setup", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should call WebhookService.ensureRepoWebhook with correct parameters", async () => {
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(mockWebhookService).toHaveBeenCalledWith(
        TestDataFactory.createServiceConfig()
      );
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: "user-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
        callbackUrl: "https://app.example.com/api/github/webhook",
      });
    });

    test("should return webhookId on success", async () => {
      const webhookId = 987654321;
      MockSetup.setupSuccessfulWebhookCreation(webhookId);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response, webhookId);
    });

    test("should generate callback URL correctly", async () => {
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(mockGetGithubWebhookCallbackUrl).toHaveBeenCalledWith(request);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: "https://app.example.com/api/github/webhook",
        })
      );
    });

    test("should retrieve service config for github service", async () => {
      MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(mockGetServiceConfig).toHaveBeenCalledWith("github");
    });

    test("should handle successful webhook creation with all parameters", async () => {
      const repository = TestDataFactory.createValidRepository({
        repositoryUrl: "https://github.com/org/repo",
      });
      MockSetup.setupRepositoryLookup(repository);
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation(111222333);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith({
        userId: "user-123",
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/org/repo",
        callbackUrl: "https://app.example.com/api/github/webhook",
      });

      const data = await response.json();
      expect(data.data.webhookId).toBe(111222333);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 500 when WebhookService throws error", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      };
      mockWebhookService.mockImplementation(() => mockInstance);
      mockGetGithubWebhookCallbackUrl.mockReturnValue("https://app.example.com/api/github/webhook");
      mockGetServiceConfig.mockReturnValue(TestDataFactory.createServiceConfig());

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectServerError(response);
    });

    test("should return 500 when database query fails", async () => {
      mockDbRepositoryFindUnique.mockRejectedValue(new Error("Database connection failed"));

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      await TestHelpers.expectServerError(response);
    });

    test("should return 500 when getGithubWebhookCallbackUrl throws error", async () => {
      mockGetGithubWebhookCallbackUrl.mockImplementation(() => {
        throw new Error("URL generation failed");
      });
      mockGetServiceConfig.mockReturnValue(TestDataFactory.createServiceConfig());

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectServerError(response);
    });

    test("should return 500 when getServiceConfig throws error", async () => {
      mockGetServiceConfig.mockImplementation(() => {
        throw new Error("Service config not found");
      });
      mockGetGithubWebhookCallbackUrl.mockReturnValue("https://app.example.com/api/github/webhook");

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectServerError(response);
    });

    test("should log error to console when exception occurs", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const testError = new Error("Test error for logging");

      mockGetServiceConfig.mockImplementation(() => {
        throw testError;
      });

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(testError);

      consoleErrorSpy.mockRestore();
    });

    test("should handle WebhookService returning null", async () => {
      const mockInstance = {
        ensureRepoWebhook: vi.fn().mockResolvedValue(null),
      };
      mockWebhookService.mockImplementation(() => mockInstance);
      mockGetGithubWebhookCallbackUrl.mockReturnValue("https://app.example.com/api/github/webhook");
      mockGetServiceConfig.mockReturnValue(TestDataFactory.createServiceConfig());

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      // This will throw an error when trying to access result.id
      await TestHelpers.expectServerError(response);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should handle very long workspace IDs", async () => {
      const longWorkspaceId = "workspace-" + "a".repeat(1000);
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: longWorkspaceId,
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: longWorkspaceId,
        })
      );
    });

    test("should handle special characters in repository URL", async () => {
      const specialRepoUrl = "https://github.com/org-name/repo-name-with-special-chars_123";
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
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
      const request = new NextRequest("http://localhost:3000/api/github/webhook/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      const response = await POST(request);

      await TestHelpers.expectServerError(response);
    });

    test("should handle request with extra unexpected fields", async () => {
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
        unexpectedField: "unexpected-value",
        anotherField: 12345,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // Should ignore extra fields and process successfully
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalled();
    });

    test("should handle webhook service returning webhookId of 0", async () => {
      MockSetup.setupSuccessfulWebhookCreation(0);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should handle repository lookup returning null repositoryUrl", async () => {
      const repository = TestDataFactory.createValidRepository({
        repositoryUrl: null as any,
      });
      MockSetup.setupRepositoryLookup(repository);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      await TestHelpers.expectValidationError(response, "Repository URL not found");
    });
  });

  describe("Integration Scenarios", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should complete full webhook setup flow with repositoryUrl", async () => {
      const webhookId = 555666777;
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation(webhookId);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      const response = await POST(request);

      // Verify all services were called in correct order
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockGetGithubWebhookCallbackUrl).toHaveBeenCalled();
      expect(mockGetServiceConfig).toHaveBeenCalledWith("github");
      expect(mockWebhookService).toHaveBeenCalled();
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalled();

      // Verify response
      await TestHelpers.expectSuccessResponse(response, webhookId);
    });

    test("should complete full webhook setup flow with repositoryId", async () => {
      const repository = TestDataFactory.createValidRepository();
      MockSetup.setupRepositoryLookup(repository);
      const webhookId = 888999000;
      const mockInstance = MockSetup.setupSuccessfulWebhookCreation(webhookId);

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryId: "repo-123",
      });

      const response = await POST(request);

      // Verify database lookup was performed
      expect(mockDbRepositoryFindUnique).toHaveBeenCalledWith({
        where: { id: "repo-123" },
        select: { repositoryUrl: true, workspaceId: true },
      });

      // Verify webhook service was called with looked-up URL
      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: repository.repositoryUrl,
        })
      );

      // Verify response
      await TestHelpers.expectSuccessResponse(response, webhookId);
    });

    test("should handle different user IDs correctly", async () => {
      const differentUserId = "user-different-456";
      mockGetServerSession.mockResolvedValue({
        user: {
          id: differentUserId,
          email: "different@example.com",
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockInstance = MockSetup.setupSuccessfulWebhookCreation();

      const request = TestHelpers.createMockRequest({
        workspaceId: "workspace-123",
        repositoryUrl: "https://github.com/test-org/test-repo",
      });

      await POST(request);

      expect(mockInstance.ensureRepoWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: differentUserId,
        })
      );
    });
  });
});