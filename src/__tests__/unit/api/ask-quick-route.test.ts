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
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((field: string, value: string) => {
        if (field === "swarmApiKey") return "decrypted-swarm-key";
        if (field === "access_token") return "decrypted-github-token";
        if (field === "source_control_token") return "decrypted-github-token";
        return "decrypted-value";
      }),
    })),
  },
}));
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));
vi.mock("@/lib/constants/prompt", () => ({
  QUICK_ASK_SYSTEM_PROMPT: "Mock system prompt",
}));
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(() => ({
    get_learnings: { execute: vi.fn() },
    recent_commits: { execute: vi.fn() },
    recent_contributions: { execute: vi.fn() },
    web_search: { execute: vi.fn() },
    final_answer: { execute: vi.fn() },
  })),
}));
vi.mock("ai", () => ({
  streamText: vi.fn(),
  hasToolCall: vi.fn(),
}));
vi.mock("aieo", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(),
}));

// Import mocked modules
const mockGetServerSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const { db: mockDb } = await import("@/lib/db");
const { validateWorkspaceAccess: mockValidateWorkspaceAccess } = await import("@/services/workspace");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { streamText: mockStreamText } = await import("ai");
const { getModel: mockGetModel, getApiKeyForProvider: mockGetApiKeyForProvider } = await import("aieo");

describe("GET /api/ask/quick - Unit Tests", () => {
  const mockQuestion = "What is the purpose of this repository?";
  const mockWorkspaceSlug = "test-workspace";
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-123";

  const mockSession = {
    user: { id: mockUserId, email: "test@example.com", name: "Test User" },
  };

  const mockWorkspace = {
    id: mockWorkspaceId,
    slug: mockWorkspaceSlug,
    name: "Test Workspace",
    ownerId: mockUserId,
  };

  const mockSwarm = {
    id: "swarm-123",
    workspaceId: mockWorkspaceId,
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: JSON.stringify({
      data: "encrypted-key",
      iv: "iv",
      tag: "tag",
      version: "v1",
      encryptedAt: new Date().toISOString(),
    }),
    repositoryUrl: "https://github.com/owner/repo",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks for successful flow
    mockGetServerSession.mockResolvedValue(mockSession);
    
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      userRole: "OWNER",
      workspace: mockWorkspace,
      canRead: true,
      canWrite: true,
      canAdmin: true,
    });

    mockDb.swarm.findFirst.mockResolvedValue(mockSwarm as any);
    mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace as any);

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "github-token-123",
    });

    mockGetApiKeyForProvider.mockReturnValue("anthropic-api-key");

    mockGetModel.mockResolvedValue({
      modelId: "claude-3-sonnet",
      provider: "anthropic",
    });

    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response(JSON.stringify({ answer: "Mock AI response" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ),
    });
  });

  describe("Authentication", () => {
    test("should return 401 if no session", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if no user in session", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Request Validation", () => {
    test("should return 400 if question is missing", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: question");
    });

    test("should return 400 if workspace is missing", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: workspace");
    });

    test("should accept valid query parameters", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
        mockWorkspaceSlug,
        mockUserId
      );
    });
  });

  describe("Authorization", () => {
    test("should return 403 if user does not have workspace access", async () => {
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    test("should allow access for workspace members", async () => {
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        userRole: "DEVELOPER",
        workspace: mockWorkspace,
        canRead: true,
        canWrite: true,
        canAdmin: false,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Configuration Validation", () => {
    test("should return 404 if swarm not found", async () => {
      mockDb.swarm.findFirst.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found for this workspace");
    });

    test("should return 404 if swarmUrl not configured", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: null,
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });

    test("should return 404 if repositoryUrl not configured", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        repositoryUrl: null,
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Repository URL not configured for this swarm");
    });

    test("should return 404 if workspace not found", async () => {
      mockDb.workspace.findUnique.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    test("should return 404 if GitHub PAT not found", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("GitHub PAT not found for this user");
    });
  });

  describe("AI Integration", () => {
    test("should initialize AI model with correct provider and API key", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      await GET(request);

      expect(mockGetApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(mockGetModel).toHaveBeenCalledWith(
        "anthropic",
        "anthropic-api-key",
        mockWorkspaceSlug
      );
    });

    test("should call streamText with correct parameters", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      await GET(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            modelId: "claude-3-sonnet",
          }),
          tools: expect.any(Object),
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user", content: mockQuestion }),
          ]),
          onStepFinish: expect.any(Function),
        })
      );
    });
  });

  describe("Streaming Response", () => {
    test("should return streaming response on success", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockStreamText).toHaveBeenCalled();
    });

    test("should call toUIMessageStreamResponse", async () => {
      const mockToUIStream = vi.fn().mockReturnValue(
        new Response("stream", { status: 200 })
      );
      mockStreamText.mockReturnValue({
        toUIMessageStreamResponse: mockToUIStream,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      await GET(request);

      expect(mockToUIStream).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on streamText error", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("Streaming error");
      });

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create stream");
    });

    test("should return 500 on general error", async () => {
      mockGetModel.mockRejectedValue(new Error("Model error"));

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });

    test("should handle database query failures", async () => {
      mockDb.swarm.findFirst.mockRejectedValue(new Error("Database error"));

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process quick ask");
    });
  });

  describe("URL Parsing", () => {
    test("should construct correct baseSwarmUrl for HTTPS URLs", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "https://swarm.example.com",
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      // baseSwarmUrl should be constructed as https://swarm.example.com:3355
    });

    test("should construct correct baseSwarmUrl for localhost URLs", async () => {
      mockDb.swarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "http://localhost:3000",
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/ask/quick?question=${encodeURIComponent(mockQuestion)}&workspace=${mockWorkspaceSlug}`
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      // baseSwarmUrl should be constructed as http://localhost:3355
    });
  });
});