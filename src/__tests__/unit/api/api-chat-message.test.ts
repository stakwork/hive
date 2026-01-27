import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/message/route";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus } from "@prisma/client";

// Mock all external dependencies at module level
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/config/env", () => ({
  config: {
    USE_MOCKS: false,
    MOCK_BASE: "http://localhost:3000",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    SWARM_SUPER_ADMIN_URL: "https://app.superadmin.sphinx.chat",
    GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com",
    API_TIMEOUT: 20000,
  },
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { getServerSession: mockGetServerSession } = await import("next-auth/next");
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/config/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { getS3Service: mockGetS3Service } = await import("@/services/s3");
const { transformSwarmUrlToRepo2Graph: mockTransformSwarmUrlToRepo2Graph } = await import("@/lib/utils/swarm");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("POST /api/chat/message", () => {
  const mockTaskId = "test-task-id";
  const mockUserId = "test-user-id";
  const mockWorkspaceId = "test-workspace-id";
  const mockMessage = "Test message";

  const mockSession = {
    user: { id: mockUserId, name: "Test User", email: "test@example.com" },
  };

  const mockTask = {
    workspaceId: mockWorkspaceId,
    workspace: {
      ownerId: mockUserId,
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-alias",
        poolName: "test-pool",
        name: "test-swarm",
      },
      members: [],
    },
  };

  const mockUser = {
    name: "Test User",
  };

  const mockChatMessage = {
    id: "message-id",
    taskId: mockTaskId,
    message: mockMessage,
    role: ChatRole.USER,
    contextTags: "[]",
    status: ChatStatus.SENT,
    sourceWebsocketID: null,
    replyId: null,
    artifacts: [],
    attachments: [],
    task: {
      id: mockTaskId,
      title: "Test Task",
    },
    timestamp: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockGetServerSession.mockResolvedValue(mockSession);
    mockDb.task.findFirst.mockResolvedValue(mockTask as any);
    mockDb.task.findUnique.mockResolvedValue({ status: "TODO" } as any);
    mockDb.user.findUnique.mockResolvedValue(mockUser as any);
    mockDb.chatMessage.create.mockResolvedValue(mockChatMessage as any);
    mockDb.chatMessage.findMany.mockResolvedValue([]);
    mockDb.task.update.mockResolvedValue({} as any);
    mockDb.workspace.findUnique.mockResolvedValue({ slug: "test-workspace" } as any);

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "token123",
    });

    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://presigned-url.com"),
    } as any);

    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://repo2graph.example.com");

    // Mock config
    mockConfig.STAKWORK_API_KEY = "test-api-key";
    mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
    mockConfig.STAKWORK_WORKFLOW_ID = "123";
  });

  describe("Authentication", () => {
    it("should return 401 if no session", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 if no user in session", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 if no user id in session", async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: "Test" } });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 if message is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    it("should return 400 if taskId is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("taskId is required");
    });

    it("should accept empty message if there are artifacts", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "",
          artifacts,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Task and User Validation", () => {
    it("should return 404 if task not found", async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 if user not found", async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 403 if user not workspace owner or member", async () => {
      const taskWithDifferentOwner = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: "different-user-id",
          members: [],
        },
      };
      mockDb.task.findFirst.mockResolvedValue(taskWithDifferentOwner as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    it("should allow access if user is workspace member", async () => {
      const taskWithMember = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: "different-user-id",
          members: [{ role: "MEMBER" }],
        },
      };
      mockDb.task.findFirst.mockResolvedValue(taskWithMember as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Message Creation", () => {
    it("should create a chat message successfully", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toMatchObject({
        id: mockChatMessage.id,
        taskId: mockTaskId,
        message: mockMessage,
        role: ChatRole.USER,
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          role: ChatRole.USER,
          contextTags: JSON.stringify([]),
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          userId: mockUserId,
          artifacts: { create: [] },
          attachments: { create: [] },
        },
        include: {
          artifacts: true,
          attachments: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              githubAuth: {
                select: { githubUsername: true },
              },
            },
          },
          task: { select: { id: true, title: true } },
        },
      });
    });

    it("should create message with artifacts", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          role: ChatRole.USER,
          contextTags: JSON.stringify([]),
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          userId: mockUserId,
          artifacts: {
            create: artifacts.map((artifact) => ({
              type: artifact.type,
              content: artifact.content,
            })),
          },
          attachments: { create: [] },
        },
        include: {
          artifacts: true,
          attachments: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              githubAuth: {
                select: { githubUsername: true },
              },
            },
          },
          task: { select: { id: true, title: true } },
        },
      });
    });

    it("should create message with attachments", async () => {
      const attachments = [
        {
          path: "/uploads/test.pdf",
          filename: "test.pdf",
          mimeType: "application/pdf",
          size: 1024,
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          attachments,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          role: ChatRole.USER,
          contextTags: JSON.stringify([]),
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          userId: mockUserId,
          artifacts: { create: [] },
          attachments: {
            create: attachments.map((attachment) => ({
              path: attachment.path,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              size: attachment.size,
            })),
          },
        },
        include: {
          artifacts: true,
          attachments: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              githubAuth: {
                select: { githubUsername: true },
              },
            },
          },
          task: { select: { id: true, title: true } },
        },
      });
    });
  });

  describe("Stakwork Integration", () => {
    it("should call Stakwork API when configured", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workflow).toMatchObject({ project_id: 123 });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://stakwork.example.com/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-api-key",
            "Content-Type": "application/json",
          },
        }),
      );
    });

    it("should update task workflow status on successful Stakwork call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 123 } }),
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 123,
        },
        select: {
          workflowStartedAt: true,
          workflowCompletedAt: true,
          featureId: true,
        },
      });
    });

    it("should update task workflow status to FAILED on Stakwork error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Server Error",
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
        select: {
          workflowStartedAt: true,
          workflowCompletedAt: true,
          featureId: true,
        },
      });
    });

    it("should use mock service when Stakwork not configured", async () => {
      mockConfig.STAKWORK_API_KEY = undefined;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  describe("Error Handling", () => {
    it("should return 500 on database error", async () => {
      mockDb.chatMessage.create.mockRejectedValue(new Error("Database error"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("should handle malformed JSON body", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: "invalid json",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe("GitHub Integration", () => {
    it("should include GitHub credentials in Stakwork payload", async () => {
      const githubCreds = {
        username: "testuser",
        token: "github-token",
      };
      mockGetGithubUsernameAndPAT.mockResolvedValue(githubCreds);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({ taskId: mockTaskId, message: mockMessage }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls.find((call) => call[0].toString().includes("stakwork"));

      expect(fetchCall).toBeTruthy();

      const body = JSON.parse(fetchCall![1]!.body as string);
      expect(body.workflow_params.set_var.attributes.vars).toMatchObject({
        alias: "testuser",
        username: "testuser",
        accessToken: "github-token",
      });
    });
  });

  describe("Task Mode Handling", () => {
    it.each([
      ["live", "123"],
      ["unit", "789"],
      ["integration", "789"],
      ["test", "456"],
      [undefined, "456"],
    ])("should use correct workflow ID for mode %s", async (mode, expectedWorkflowId) => {
      mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as any);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          mode,
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls.find((call) => call[0].toString().includes("stakwork"));

      const body = JSON.parse(fetchCall![1]!.body as string);
      expect(body.workflow_id).toBe(parseInt(expectedWorkflowId));
    });
  });
});
