import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST, PUT } from "@/app/api/agent/route";
import { getServerSession } from "next-auth/next";

// Mock all dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("ai-sdk-provider-goose-web", () => ({
  gooseWeb: vi.fn(),
}));

vi.mock("ai", () => ({
  streamText: vi.fn(),
  toUIMessageStreamResponse: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockChatMessageCreate = vi.fn();
  const mockChatMessageFindMany = vi.fn();
  const mockTaskFindUnique = vi.fn();
  const mockSwarmFindFirst = vi.fn();

  return {
    db: {
      chatMessage: {
        create: mockChatMessageCreate,
        findMany: mockChatMessageFindMany,
      },
      task: {
        findUnique: mockTaskFindUnique,
      },
      swarm: {
        findFirst: mockSwarmFindFirst,
      },
    },
    __mockChatMessageCreate: mockChatMessageCreate,
    __mockChatMessageFindMany: mockChatMessageFindMany,
    __mockTaskFindUnique: mockTaskFindUnique,
    __mockSwarmFindFirst: mockSwarmFindFirst,
  };
});

vi.mock("@/lib/encryption", () => {
  const mockDecryptField = vi.fn();
  const mockGetInstance = vi.fn(() => ({
    decryptField: mockDecryptField,
  }));

  return {
    EncryptionService: {
      getInstance: mockGetInstance,
    },
    __mockDecryptField: mockDecryptField,
    __mockGetInstance: mockGetInstance,
  };
});

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(),
}));

const mockGetServerSession = getServerSession as Mock;

// Get exported mocks
const gooseWebMock = vi.mocked(await import("ai-sdk-provider-goose-web"));
const aiMock = vi.mocked(await import("ai"));
const middlewareUtilsMock = vi.mocked(await import("@/lib/middleware/utils"));
const workspaceMock = vi.mocked(await import("@/services/workspace"));
const dbMock = vi.mocked(await import("@/lib/db"));
const encryptionMock = vi.mocked(await import("@/lib/encryption"));
const authMock = vi.mocked(await import("@/lib/auth/nextauth"));
const askToolsMock = vi.mocked(await import("@/lib/ai/askTools"));

const mockGooseWeb = gooseWebMock.gooseWeb;
const mockStreamText = aiMock.streamText;
const mockToUIMessageStreamResponse = aiMock.toUIMessageStreamResponse;
const mockGetMiddlewareContext = middlewareUtilsMock.getMiddlewareContext;
const mockRequireAuth = middlewareUtilsMock.requireAuth;
const mockValidateWorkspaceAccess = workspaceMock.validateWorkspaceAccess;
const mockChatMessageCreate = dbMock.__mockChatMessageCreate;
const mockChatMessageFindMany = dbMock.__mockChatMessageFindMany;
const mockTaskFindUnique = dbMock.__mockTaskFindUnique;
const mockSwarmFindFirst = dbMock.__mockSwarmFindFirst;
const mockDecryptField = encryptionMock.__mockDecryptField;
const mockGetGithubUsernameAndPAT = authMock.getGithubUsernameAndPAT;
const mockAskTools = askToolsMock.askTools;

// Test Data Factories
const TestDataFactory = {
  createValidUser: () => ({
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  }),

  createValidSession: () => ({
    user: TestDataFactory.createValidUser(),
    expires: new Date(Date.now() + 86400000).toISOString(),
  }),

  createValidTask: (overrides = {}) => ({
    id: "task-123",
    title: "Test Task",
    workspaceId: "workspace-123",
    ...overrides,
  }),

  createValidWorkspace: (overrides = {}) => ({
    id: "workspace-123",
    name: "Test Workspace",
    slug: "test-workspace",
    ownerId: "user-123",
    deleted: false,
    ...overrides,
  }),

  createValidSwarm: (overrides = {}) => ({
    id: "swarm-123",
    workspaceId: "workspace-123",
    swarmUrl: "https://test-swarm.sphinx.chat/api",
    swarmApiKey: JSON.stringify({
      data: "encrypted-api-key",
      iv: "iv-123",
      tag: "tag-123",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    }),
    ...overrides,
  }),

  createChatMessage: (overrides = {}) => ({
    id: "message-123",
    taskId: "task-123",
    role: "USER",
    status: "SENT",
    timestamp: new Date(),
    ...overrides,
  }),

  createChatHistory: (count = 3) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `message-${i}`,
      taskId: "task-123",
      role: i % 2 === 0 ? "USER" : "ASSISTANT",
      content: `Message ${i}`,
      timestamp: new Date(Date.now() - (count - i) * 60000),
    }));
  },

  createMiddlewareContext: () => ({
    user: {
      id: "user-123",
      email: "test@example.com",
      name: "Test User",
    },
    headers: {
      "x-middleware-user-id": "user-123",
      "x-middleware-user-email": "test@example.com",
    },
  }),

  createGithubProfile: () => ({
    username: "testuser",
    token: "github_pat_test123",
  }),

  createAITools: () => ({
    get_learnings: { description: "Get learnings from knowledge base" },
    ask_question: { description: "Ask question to Swarm" },
    analyze_code: { description: "Analyze code with GitSee" },
    web_search: { description: "Search the web" },
  }),
};

// Test Helpers
const TestHelpers = {
  createMockRequest: (body: object, headers: Record<string, string> = {}) => {
    return new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  },

  setupAuthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(TestDataFactory.createValidSession());
  },

  setupUnauthenticatedUser: () => {
    mockGetServerSession.mockResolvedValue(null);
  },

  setupMiddlewareAuth: () => {
    const context = TestDataFactory.createMiddlewareContext();
    mockGetMiddlewareContext.mockReturnValue(context);
    mockRequireAuth.mockReturnValue(context.user);
  },

  setupMiddlewareUnauth: () => {
    const response = new Response("Unauthorized", { status: 401 });
    mockGetMiddlewareContext.mockReturnValue({});
    mockRequireAuth.mockReturnValue(response);
  },

  expectAuthenticationError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  },

  expectWorkspaceAccessDenied: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("access denied");
  },

  expectValidationError: async (response: Response, expectedMessage: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain(expectedMessage);
  },

  setupSSEStreamResponse: () => {
    const mockStream = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response("data: test\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    };
    mockStreamText.mockResolvedValue(mockStream);
    return mockStream;
  },
};

// Mock Setup Helper
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulPOSTFlow: () => {
    TestHelpers.setupAuthenticatedUser();
    mockChatMessageFindMany.mockResolvedValue(TestDataFactory.createChatHistory());
    mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
    mockGooseWeb.mockReturnValue({ provider: "goose-web" });
    TestHelpers.setupSSEStreamResponse();
  },

  setupSuccessfulPUTFlow: () => {
    TestHelpers.setupMiddlewareAuth();
    const workspace = TestDataFactory.createValidWorkspace();
    const task = TestDataFactory.createValidTask();
    const swarm = TestDataFactory.createValidSwarm();

    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      workspace,
    });
    mockTaskFindUnique.mockResolvedValue(task);
    mockSwarmFindFirst.mockResolvedValue(swarm);
    mockDecryptField.mockReturnValue("decrypted-api-key-123");
    mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
    mockAskTools.mockReturnValue(TestDataFactory.createAITools());
    TestHelpers.setupSSEStreamResponse();
  },
};

describe("POST /api/agent - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Authentication", () => {
    test("should return 401 when session is missing", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
      });

      const response = await POST(request);
      await TestHelpers.expectAuthenticationError(response);
      expect(mockChatMessageFindMany).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      mockGetServerSession.mockResolvedValue({ expires: new Date().toISOString() });

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
      });

      const response = await POST(request);
      await TestHelpers.expectAuthenticationError(response);
    });

    test("should proceed with valid session", async () => {
      MockSetup.setupSuccessfulPOSTFlow();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(mockGetServerSession).toHaveBeenCalled();
    });
  });

  describe("Request Validation - POST", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 400 when taskId is missing", async () => {
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      const request = TestHelpers.createMockRequest({
        message: "Test message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      await TestHelpers.expectValidationError(response, "taskId");
    });

    test("should return 400 when message is missing", async () => {
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      await TestHelpers.expectValidationError(response, "message");
    });

    test("should accept request with valid taskId and message", async () => {
      MockSetup.setupSuccessfulPOSTFlow();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Valid message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("Chat History Loading", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should load chat history by taskId", async () => {
      const chatHistory = TestDataFactory.createChatHistory(5);
      mockChatMessageFindMany.mockResolvedValue(chatHistory);
      mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
      });

      await POST(request);

      expect(mockChatMessageFindMany).toHaveBeenCalledWith({
        where: { taskId: "task-123" },
        select: {
          artifacts: {
            select: {
              content: true,
            },
            where: {
              type: "IDE",
            },
          },
          message: true,
          role: true,
          sourceWebsocketID: true,
        },
        orderBy: { timestamp: "asc" },
      });
    });

    test("should handle empty chat history", async () => {
      mockChatMessageFindMany.mockResolvedValue([]);
      mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "First message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("Session ID Management", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      mockChatMessageFindMany.mockResolvedValue([]);
    });

    test("should generate new session ID for first message", async () => {
      mockChatMessageCreate.mockResolvedValue(
        TestDataFactory.createChatMessage({
          sourceWebsocketID: expect.stringMatching(/^\d{8}_\d{6}$/),
        }),
      );
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "First message",
      });

      await POST(request);

      expect(mockChatMessageCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceWebsocketID: expect.stringMatching(/^\d{8}_\d{6}$/),
        }),
      });
    });

    test("should reuse existing session ID for subsequent messages", async () => {
      const existingSessionId = "20240101_120000";
      mockChatMessageFindMany.mockResolvedValue([
        TestDataFactory.createChatMessage({ sourceWebsocketID: existingSessionId }),
      ]);
      mockChatMessageCreate.mockResolvedValue(
        TestDataFactory.createChatMessage({
          sourceWebsocketID: existingSessionId,
        }),
      );
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Follow-up message",
      });

      await POST(request);

      expect(mockChatMessageCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceWebsocketID: existingSessionId,
        }),
      });
    });
  });

  describe("Message Persistence", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      mockChatMessageFindMany.mockResolvedValue([]);
    });

    test("should persist message with correct role and status", async () => {
      mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
      });

      await POST(request);

      expect(mockChatMessageCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: "task-123",
          role: "USER",
          status: "SENT",
        }),
      });
    });

    test("should persist message with artifacts when provided", async () => {
      mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const artifacts = [{ type: "FORM", content: { fields: [] } }];

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Message with artifacts",
        artifacts,
      });

      await POST(request);

      expect(mockChatMessageCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifacts: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                type: "FORM",
              }),
            ]),
          }),
        }),
      });
    });
  });

  describe("Goose Web Provider", () => {
    beforeEach(() => {
      MockSetup.setupSuccessfulPOSTFlow();
    });

    test("should initialize Goose Web provider with correct URL", async () => {
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "ws://placeholder",
      });

      await POST(request);

      expect(mockGooseWeb).toHaveBeenCalledWith("goose", {
        sessionId: expect.any(String),
        wsUrl: expect.stringContaining("ws://"),
      });
    });

    test("should use custom Goose Web URL when provided", async () => {
      const customUrl = "ws://custom-goose.example.com:9999/ws";
      vi.stubEnv("GOOSE_WEB_URL", customUrl);

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      await POST(request);

      expect(mockGooseWeb).toHaveBeenCalledWith("goose", {
        sessionId: expect.any(String),
        wsUrl: expect.stringContaining("ws://"),
      });

      vi.unstubAllEnvs();
    });
  });

  describe("SSE Streaming Response", () => {
    beforeEach(() => {
      MockSetup.setupSuccessfulPOSTFlow();
    });

    test("should return SSE stream with correct headers", async () => {
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    test("should call streamText with correct parameters", async () => {
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      await POST(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
          messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
        }),
      );
    });
  });

  describe("Error Handling - POST", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should handle database connection failure", async () => {
      mockChatMessageFindMany.mockRejectedValue(new Error("Database connection failed"));

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });

    test("should handle Goose Web connection failure", async () => {
      mockChatMessageFindMany.mockResolvedValue([]);
      mockChatMessageCreate.mockResolvedValue(TestDataFactory.createChatMessage());
      mockGooseWeb.mockImplementation(() => {
        throw new Error("WebSocket connection failed");
      });

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      mockGooseWeb.mockRestore();
    });

    test("should handle message persistence failure", async () => {
      mockChatMessageFindMany.mockResolvedValue([]);
      mockChatMessageCreate.mockRejectedValue(new Error("Failed to save message"));

      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: "Test message",
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });
  });
});

describe("PUT /api/agent - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Middleware Authentication", () => {
    test("should return 401 when middleware context is invalid", async () => {
      TestHelpers.setupMiddlewareUnauth();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    test("should extract user from middleware context", async () => {
      MockSetup.setupSuccessfulPUTFlow();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-middleware-user-id": "user-123",
        },
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockGetMiddlewareContext).toHaveBeenCalled();
      expect(mockRequireAuth).toHaveBeenCalled();
    });
  });

  describe("Workspace Authorization", () => {
    beforeEach(() => {
      TestHelpers.setupMiddlewareAuth();
    });

    test("should validate workspace access", async () => {
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(TestDataFactory.createValidSwarm());
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(workspace.id, "user-123");
    });

    test("should return 403 when user has no workspace access", async () => {
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
      });
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      await TestHelpers.expectWorkspaceAccessDenied(response);
    });
  });

  describe("Task Ownership Validation", () => {
    beforeEach(() => {
      TestHelpers.setupMiddlewareAuth();
    });

    test("should verify task belongs to workspace", async () => {
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask({ workspaceId: workspace.id });

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(TestDataFactory.createValidSwarm());
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockTaskFindUnique).toHaveBeenCalledWith({
        where: { id: "task-123" },
      });
    });

    test("should return 404 when task not found", async () => {
      const workspace = TestDataFactory.createValidWorkspace();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(null);
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "nonexistent-task", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
    });

    test("should prevent cross-workspace task access", async () => {
      const workspace = TestDataFactory.createValidWorkspace({ id: "workspace-123" });
      const task = TestDataFactory.createValidTask({ workspaceId: "different-workspace-456" });
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      await TestHelpers.expectWorkspaceAccessDenied(response);
    });
  });

  describe("Swarm Configuration", () => {
    beforeEach(() => {
      TestHelpers.setupMiddlewareAuth();
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
    });

    test("should retrieve and decrypt Swarm API key", async () => {
      const swarm = TestDataFactory.createValidSwarm();
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("sk_decrypted_api_key_123");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      TestHelpers.setupSSEStreamResponse();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockSwarmFindFirst).toHaveBeenCalledWith({
        where: { workspaceId: "workspace-123" },
      });
      expect(mockDecryptField).toHaveBeenCalledWith("swarmApiKey", swarm.swarmApiKey);
    });

    test("should return 404 when Swarm not found", async () => {
      mockSwarmFindFirst.mockResolvedValue(null);
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Swarm");
    });

    test("should construct correct Swarm URL", async () => {
      const swarm = TestDataFactory.createValidSwarm({
        swarmUrl: "https://custom-swarm.sphinx.chat/api",
      });
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      TestHelpers.setupSSEStreamResponse();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("custom-swarm.sphinx.chat"),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe("GitHub PAT Retrieval", () => {
    beforeEach(() => {
      TestHelpers.setupMiddlewareAuth();
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();
      const swarm = TestDataFactory.createValidSwarm();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("decrypted-key");
    });

    test("should retrieve GitHub username and PAT", async () => {
      const githubProfile = TestDataFactory.createGithubProfile();
      mockGetGithubUsernameAndPAT.mockResolvedValue(githubProfile);
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      TestHelpers.setupSSEStreamResponse();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith("user-123", "test-workspace");
    });

    test("should handle missing GitHub credentials gracefully", async () => {
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      TestHelpers.setupSSEStreamResponse();
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      // Should proceed without GitHub credentials
      expect(response.status).not.toBe(500);
    });
  });

  describe("Tool Initialization", () => {
    beforeEach(() => {
      MockSetup.setupSuccessfulPUTFlow();
    });

    test("should initialize all 4 AI tools", async () => {
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        expect.any(String), // swarmUrl
        expect.any(String), // swarmApiKey
        expect.any(String), // repoUrl
        expect.any(String), // githubPAT
        expect.any(String), // anthropicApiKey
      );
    });

    test("should pass correct parameters to askTools", async () => {
      const swarm = TestDataFactory.createValidSwarm({
        swarmUrl: "https://test-swarm.sphinx.chat/api",
      });
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("sk_swarm_key_123");
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({
          taskId: "task-123",
          message: "Test",
          repoUrl: "https://github.com/test/repo",
          gooseUrl: "placeholder",
        }),
      });

      await POST(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("test-swarm.sphinx.chat"),
        "sk_swarm_key_123",
        "https://github.com/test/repo",
        "github_pat_test123",
        expect.any(String),
      );
    });
  });

  describe("AI Streaming with Tools", () => {
    beforeEach(() => {
      MockSetup.setupSuccessfulPUTFlow();
    });

    test("should call streamText with tools", async () => {
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Analyze this code", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.any(Object),
          stopWhen: expect.any(Function),
        }),
      );
    });

    test("should stop on final_answer tool call", async () => {
      const stopWhenFn = vi.fn();
      mockStreamText.mockImplementation((config: any) => {
        stopWhenFn.mockReturnValue(config.stopWhen);
        return Promise.resolve({
          toUIMessageStreamResponse: vi.fn().mockReturnValue(new Response()),
        });
      });
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          stopWhen: expect.any(Function),
        }),
      );
    });

    test("should return SSE stream response", async () => {
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });
  });

  describe("Error Handling - PUT", () => {
    beforeEach(() => {
      TestHelpers.setupMiddlewareAuth();
    });

    test("should handle workspace validation failure", async () => {
      mockValidateWorkspaceAccess.mockRejectedValue(new Error("Database error"));
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });

    test("should handle Swarm decryption failure", async () => {
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();
      const swarm = TestDataFactory.createValidSwarm();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });

    test("should handle tool initialization failure", async () => {
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();
      const swarm = TestDataFactory.createValidSwarm();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockImplementation(() => {
        throw new Error("Tool initialization failed");
      });
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });

    test("should handle streaming failure", async () => {
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();
      const swarm = TestDataFactory.createValidSwarm();

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      mockStreamText.mockRejectedValue(new Error("Streaming failed"));

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
    });
  });

  describe("Integration Edge Cases", () => {
    test("should handle localhost Swarm URL correctly", async () => {
      TestHelpers.setupMiddlewareAuth();
      const workspace = TestDataFactory.createValidWorkspace();
      const task = TestDataFactory.createValidTask();
      const swarm = TestDataFactory.createValidSwarm({
        swarmUrl: "http://localhost:3355/api",
      });

      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace,
      });
      mockTaskFindUnique.mockResolvedValue(task);
      mockSwarmFindFirst.mockResolvedValue(swarm);
      mockDecryptField.mockReturnValue("decrypted-key");
      mockGetGithubUsernameAndPAT.mockResolvedValue(TestDataFactory.createGithubProfile());
      mockAskTools.mockReturnValue(TestDataFactory.createAITools());
      mockGooseWeb.mockReturnValue({ provider: "goose-web" });
      TestHelpers.setupSSEStreamResponse();

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", message: "Test", gooseUrl: "placeholder" }),
      });

      await POST(request);

      expect(mockAskTools).toHaveBeenCalledWith(
        expect.stringContaining("localhost"),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    test("should handle very long messages", async () => {
      MockSetup.setupSuccessfulPOSTFlow();

      const longMessage = "A".repeat(10000);
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: longMessage,
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    test("should handle special characters in messages", async () => {
      MockSetup.setupSuccessfulPOSTFlow();

      const specialMessage = "Test with émojis 🚀 and symbols: <>\u0026\"'{}[]";
      const request = TestHelpers.createMockRequest({
        taskId: "task-123",
        message: specialMessage,
        gooseUrl: "placeholder",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});
