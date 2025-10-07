import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/ask/quick/route";

// Mock all external dependencies at module level
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
// Create a consistent mock instance
const mockDecryptField = vi.fn();

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(() => ({})),
}));
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(() => vi.fn()),
}));
vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(() => "test-api-key"),
  getModel: vi.fn(() => ({ modelId: "claude-3-5-sonnet-20241022" })),
}));

// Import mocked modules
const { getServerSession: mockGetServerSession } = await import("next-auth/next");
const { db: mockDb } = await import("@/lib/db");
const { EncryptionService: mockEncryptionService } = await import("@/lib/encryption");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { validateWorkspaceAccess: mockValidateWorkspaceAccess } = await import("@/services/workspace");
const { askTools: mockAskTools } = await import("@/lib/ai/askTools");
const { streamText: mockStreamText } = await import("ai");
const { getApiKeyForProvider: mockGetApiKeyForProvider, getModel: mockGetModel } = await import("aieo");

// Test Data Factories
const TestDataFactories = {
  session: (overrides = {}) => ({
    user: {
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
      ...overrides,
    },
  }),

  workspaceAccess: (overrides = {}) => ({
    hasAccess: true,
    workspace: {
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: "test-user-id",
    },
    userRole: "OWNER",
    canRead: true,
    canWrite: true,
    canAdmin: true,
    ...overrides,
  }),

  swarm: (overrides = {}) => ({
    id: "swarm-id",
    swarmUrl: "https://swarm.example.com/api",
    swarmApiKey: JSON.stringify({ data: "encrypted-key", iv: "iv", tag: "tag", version: "v1" }),
    repositoryUrl: "https://github.com/test-owner/test-repo",
    workspaceId: "test-workspace-id",
    ...overrides,
  }),

  workspace: (overrides = {}) => ({
    id: "test-workspace-id",
    slug: "test-workspace",
    name: "Test Workspace",
    ownerId: "test-user-id",
    ...overrides,
  }),

  githubProfile: (overrides = {}) => ({
    username: "testuser",
    token: "github_pat_test_token",
    ...overrides,
  }),

  streamTextResult: () => ({
    toUIMessageStreamResponse: vi.fn(() => new Response("stream-response")),
  }),
};

// Test Utilities
const TestUtils = {
  createGetRequest: (url: string) => {
    return new NextRequest(url, { method: "GET" });
  },

  setupDefaultMocks: () => {
    mockGetServerSession.mockResolvedValue(TestDataFactories.session());
    mockValidateWorkspaceAccess.mockResolvedValue(TestDataFactories.workspaceAccess());
    mockDb.swarm.findFirst.mockResolvedValue(TestDataFactories.swarm());
    mockDb.workspace.findUnique.mockResolvedValue(TestDataFactories.workspace());
    mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactories.githubProfile());
    mockDecryptField.mockReturnValue("decrypted-api-key");
    mockGetApiKeyForProvider.mockReturnValue("test-anthropic-key");
    mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
    mockAskTools.mockReturnValue({});
    mockStreamText.mockReturnValue(TestDataFactories.streamTextResult());
  },

  expectJsonResponse: async (response: Response, expectedStatus: number, expectedError?: string) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    if (expectedError) {
      expect(data.error).toBe(expectedError);
    }
    return data;
  },
};

describe("GET /api/ask/quick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestUtils.setupDefaultMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 when no session provided", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 401, "Unauthorized");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should return 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 401, "Unauthorized");
    });
  });

  describe("Request Validation Tests", () => {
    test("should return 400 when question parameter is missing", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 400, "Missing required parameter: question");
    });

    test("should return 400 when workspace parameter is missing", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 400, "Missing required parameter: workspace");
    });

    test("should return 400 when both parameters are missing", async () => {
      const request = TestUtils.createGetRequest("http://localhost:3000/api/ask/quick");

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 400, "Missing required parameter: question");
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 when user has no workspace access", async () => {
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 403, "Workspace not found or access denied");
      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "test-user-id");
    });

    test("should validate workspace access with correct parameters", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=my-workspace"
      );

      await GET(request);

      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith("my-workspace", "test-user-id");
    });
  });

  describe("Configuration & Credentials Tests", () => {
    test("should return 404 when swarm not found for workspace", async () => {
      mockDb.swarm.findFirst.mockResolvedValue(null);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "Swarm not found for this workspace");
    });

    test("should return 404 when swarm URL not configured", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...TestDataFactories.swarm(),
        swarmUrl: null,
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "Swarm URL not configured");
    });

    test("should return 404 when repository URL not configured", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...TestDataFactories.swarm(),
        repositoryUrl: null,
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "Repository URL not configured for this swarm");
    });

    test("should return 404 when workspace not found for PAT retrieval", async () => {
      mockDb.workspace.findUnique.mockResolvedValue(null);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "Workspace not found");
    });

    test("should return 404 when GitHub PAT not found for user", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "GitHub PAT not found for this user");
    });

    test("should return 404 when GitHub PAT token is missing", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: null,
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 404, "GitHub PAT not found for this user");
    });

    test("should decrypt swarm API key with correct parameters", async () => {
      const encryptedKey = JSON.stringify({ data: "encrypted", iv: "iv", tag: "tag" });
      mockDb.swarm.findFirst.mockResolvedValue({
        ...TestDataFactories.swarm(),
        swarmApiKey: encryptedKey,
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      await GET(request);

      expect(mockDecryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        encryptedKey
      );
    });
  });

  describe("Tool Integration Tests", () => {
    test("should create AI tools with correct parameters", async () => {
      mockDecryptField.mockReturnValue("decrypted-swarm-key");

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=What is this repo?&workspace=test-workspace"
      );

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "https://swarm.example.com:3355",
        "decrypted-swarm-key",
        "https://github.com/test-owner/test-repo",
        "github_pat_test_token",
        "test-anthropic-key"
      );
    });

    test("should use localhost URL for local swarm", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...TestDataFactories.swarm(),
        swarmUrl: "http://localhost:3000/api",
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "http://localhost:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    test("should retrieve API key for anthropic provider", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      await GET(request);

      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
    });

    test("should get model with correct parameters", async () => {
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key-123");

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=my-workspace"
      );

      await GET(request);

      expect(mockGetModel).toHaveBeenCalledWith("anthropic", "anthropic-key-123", "my-workspace");
    });
  });

  describe("Streaming Behavior Tests", () => {
    test("should successfully stream AI response", async () => {
      const mockStreamResult = TestDataFactories.streamTextResult();
      mockStreamText.mockReturnValue(mockStreamResult);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      expect(response.constructor.name).toBe("Response");
      expect(mockStreamText).toHaveBeenCalled();
      expect(mockStreamResult.toUIMessageStreamResponse).toHaveBeenCalled();
    });

    test("should call streamText with correct parameters", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=How does this work?&workspace=test-workspace"
      );

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { modelId: "claude-3-5-sonnet-20241022" },
          tools: {},
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user", content: "How does this work?" }),
          ]),
        })
      );
    });

    test("should return 500 when streamText throws error", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("AI streaming failed");
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 500, "Failed to create stream");
    });

    test("should return 500 when toUIMessageStreamResponse fails", async () => {
      const mockStreamResult = {
        toUIMessageStreamResponse: vi.fn(() => {
          throw new Error("Stream conversion failed");
        }),
      };
      mockStreamText.mockReturnValue(mockStreamResult);

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 500, "Failed to create stream");
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 when unexpected error occurs", async () => {
      mockValidateWorkspaceAccess.mockRejectedValue(new Error("Database connection failed"));

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 500, "Failed to process quick ask");
    });

    test("should handle EncryptionService errors gracefully", async () => {
      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 500, "Failed to process quick ask");
    });
  });

  describe("Edge Cases Tests", () => {
    test("should handle empty question parameter", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=&workspace=test-workspace"
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 400, "Missing required parameter: question");
    });

    test("should handle empty workspace parameter", async () => {
      const request = TestUtils.createGetRequest(
        "http://localhost:3000/api/ask/quick?question=test&workspace="
      );

      const response = await GET(request);

      await TestUtils.expectJsonResponse(response, 400, "Missing required parameter: workspace");
    });

    test("should handle very long question", async () => {
      const longQuestion = "a".repeat(10000);
      const request = TestUtils.createGetRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(longQuestion)}&workspace=test-workspace`
      );

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: longQuestion }),
          ]),
        })
      );
    });

    test("should handle special characters in question", async () => {
      const specialQuestion = "What about this? & that < > \" '";
      const request = TestUtils.createGetRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(specialQuestion)}&workspace=test-workspace`
      );

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: specialQuestion }),
          ]),
        })
      );
    });

    test("should handle workspace slug with special characters", async () => {
      const specialSlug = "my-workspace_123";
      const request = TestUtils.createGetRequest(
        `http://localhost:3000/api/ask/quick?question=test&workspace=${specialSlug}`
      );

      await GET(request);

      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(specialSlug, "test-user-id");
    });
  });
});