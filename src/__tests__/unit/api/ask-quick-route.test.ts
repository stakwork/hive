import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/ask/quick/route";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import {
  createMockUser,
  createMockSwarm,
  createMockWorkspace,
  createMockRepository,
  createMockGithubProfile,
  createMockAITools,
} from "@/__tests__/support/helpers/ask-api-helpers";

// Mock middleware utils
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

// Mock database
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

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Mock workspace validation
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Mock GitHub PAT retrieval
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

// Mock repository helper
vi.mock("@/lib/helpers/repository", () => ({
  getPrimaryRepository: vi.fn(),
}));

// Mock AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(() => () => false),
}));

// Mock aieo
vi.mock("aieo", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(),
}));

// Mock askTools
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

// Import mocked functions
import { streamText, hasToolCall } from "ai";
import { getModel, getApiKeyForProvider } from "aieo";
import { askTools } from "@/lib/ai/askTools";

const mockGetMiddlewareContext = getMiddlewareContext as Mock;
const mockRequireAuth = requireAuth as Mock;
const mockValidateWorkspaceAccess = validateWorkspaceAccess as Mock;
const mockDbSwarm = db.swarm as { findFirst: Mock };
const mockDbWorkspace = db.workspace as { findUnique: Mock };
const mockGetGithubUsernameAndPAT = getGithubUsernameAndPAT as Mock;
const mockGetPrimaryRepository = getPrimaryRepository as Mock;
const mockStreamText = streamText as Mock;
const mockGetModel = getModel as Mock;
const mockGetApiKeyForProvider = getApiKeyForProvider as Mock;
const mockAskTools = askTools as Mock;

describe("GET /api/ask/quick - Unit Tests", () => {
  let mockEncryptionService: {
    decryptField: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup EncryptionService mock instance
    mockEncryptionService = {
      decryptField: vi.fn(),
    };
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);

    // Default mock for hasToolCall
    (hasToolCall as Mock).mockReturnValue(() => false);
  });

  const createMockRequest = (question?: string, workspace?: string) => {
    const url = new URL("http://localhost:3000/api/ask/quick");
    if (question) url.searchParams.set("question", question);
    if (workspace) url.searchParams.set("workspace", workspace);

    const request = new NextRequest(url.toString(), { method: "GET" });
    
    // Setup middleware context mock
    mockGetMiddlewareContext.mockReturnValue({
      user: { id: "user-123" },
    });

    return request;
  };

  const mockUser = createMockUser();
  const mockSwarm = createMockSwarm();
  const mockWorkspace = createMockWorkspace();
  const mockRepository = createMockRepository();
  const mockGithubProfile = createMockGithubProfile();
  const mockTools = createMockAITools();

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const request = createMockRequest("test question", "test-workspace");
      const unauthorizedResponse = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
      mockRequireAuth.mockReturnValue(unauthorizedResponse);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should proceed when user is authenticated", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      await GET(request);

      expect(mockRequireAuth).toHaveBeenCalled();
      expect(mockValidateWorkspaceAccess).toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when question parameter is missing", async () => {
      const request = createMockRequest(undefined, "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: question");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should return 400 when workspace parameter is missing", async () => {
      const request = createMockRequest("test question", undefined);
      mockRequireAuth.mockReturnValue(mockUser);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: workspace");
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user has no workspace access", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockDbSwarm.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Configuration Validation", () => {
    test("should return 404 when swarm not found", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(null);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found for this workspace");
    });

    test("should return 404 when swarm URL not configured", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: null,
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });

    test("should return 404 when repository URL not configured", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(null);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Repository URL not configured for this swarm");
    });

    test("should return 404 when GitHub PAT not found", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("GitHub PAT not found for this user");
    });
  });

  describe("AI Service Configuration", () => {
    test("should retrieve Anthropic API key", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("swarm-api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-api-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
    });

    test("should get correct model from aieo", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("swarm-api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-api-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      expect(mockGetModel).toHaveBeenCalledWith(
        "anthropic",
        "anthropic-api-key",
        "test-workspace"
      );
    });
  });

  describe("AI Tools Creation", () => {
    test("should create askTools with correct parameters", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "https://swarm.example.com",
      });
      mockEncryptionService.decryptField.mockReturnValue("decrypted-swarm-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "https://swarm.example.com:3355",
        "decrypted-swarm-key",
        "https://github.com/test/repo",
        "github-pat-123",
        "anthropic-key"
      );
    });

    test("should handle localhost swarm URL", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "http://localhost:8080",
      });
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        "http://localhost:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe("Streaming Response", () => {
    test("should call streamText with correct parameters", async () => {
      const request = createMockRequest("What is testing?", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      mockGetModel.mockResolvedValue(mockModel);
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith({
        model: mockModel,
        tools: mockTools,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user", content: "What is testing?" }),
        ]),
        stopWhen: expect.any(Function),
        onStepFinish: expect.any(Function),
      });
    });

    test("should include system prompt in messages", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("mock stream")),
      });

      await GET(request);

      const streamTextCall = mockStreamText.mock.calls[0][0];
      expect(streamTextCall.messages).toHaveLength(2);
      expect(streamTextCall.messages[0].role).toBe("system");
      expect(streamTextCall.messages[0].content).toContain("source code learning assistant");
    });

    test("should return streaming response", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      
      const mockStreamResponse = new Response("test stream", {
        headers: { "Content-Type": "text/event-stream" },
      });
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => mockStreamResponse),
      });

      const response = await GET(request);

      expect(response).toBe(mockStreamResponse);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    test("should handle streamText error", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      mockStreamText.mockImplementation(() => {
        throw new Error("Stream creation failed");
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create stream");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockRejectedValue(new Error("Database connection failed"));

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should handle encryption errors", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should handle getGithubUsernameAndPAT errors", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockRejectedValue(new Error("Failed to retrieve PAT"));

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should not expose sensitive error details", async () => {
      const request = createMockRequest("test question", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockRejectedValue(
        new Error("Database error: api-key-secret-123")
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(JSON.stringify(data)).not.toContain("api-key-secret-123");
    });
  });

  describe("Complete Request Flow", () => {
    test("should successfully process complete AI request flow", async () => {
      const request = createMockRequest("How do I test React components?", "test-workspace");
      mockRequireAuth.mockReturnValue(mockUser);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: mockWorkspace,
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("swarm-key");
      mockGetPrimaryRepository.mockResolvedValue(mockRepository);
      mockDbWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubProfile);
      mockGetApiKeyForProvider.mockReturnValue("anthropic-key");
      mockGetModel.mockResolvedValue({ modelId: "claude-3-5-sonnet-20241022" });
      mockAskTools.mockReturnValue(mockTools);
      
      const mockStreamResponse = new Response("AI response stream", {
        headers: { "Content-Type": "text/event-stream" },
      });
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => mockStreamResponse),
      });

      const response = await GET(request);

      expect(response).toBeDefined();
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Verify all steps were called
      expect(mockRequireAuth).toHaveBeenCalled();
      expect(mockValidateWorkspaceAccess).toHaveBeenCalled();
      expect(mockDbSwarm.findFirst).toHaveBeenCalled();
      expect(mockEncryptionService.decryptField).toHaveBeenCalled();
      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalled();
      expect(mockGetApiKeyForProvider).toHaveBeenCalled();
      expect(mockGetModel).toHaveBeenCalled();
      expect(mockAskTools).toHaveBeenCalled();
      expect(mockStreamText).toHaveBeenCalled();
    });
  });
});