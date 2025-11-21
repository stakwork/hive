import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { POST } from "../route";
import { ChatRole, ChatStatus, WorkflowStatus } from "@prisma/client";

// Mock external dependencies
jest.mock("next-auth");
jest.mock("@/lib/db");
jest.mock("@/services/stakwork/stakwork", () => ({
  callStakwork: jest.fn(),
}));
jest.mock("@/services/mock/mock", () => ({
  callMock: jest.fn(),
}));
jest.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: jest.fn(),
  },
}));
jest.mock("@/lib/github", () => ({
  getGithubUsernameAndPAT: jest.fn(),
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockDb = db as jest.Mocked<typeof db>;

describe("POST /api/chat/message Integration Tests", () => {
  const mockUserId = "user-123";
  const mockTaskId = "task-456";
  const mockWorkspaceId = "workspace-789";

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockGetServerSession.mockResolvedValue({
      user: { id: mockUserId },
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication and Authorization", () => {
    it("should return 401 when no session exists", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when user ID is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: {},
      } as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when message is missing", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    it("should return 400 when taskId is missing", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("taskId is required");
    });
  });

  describe("Database Operations", () => {
    it("should return 404 when task is not found", async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          deleted: false,
        },
        select: expect.any(Object),
      });
    });

    it("should return 404 when user is not found", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    it("should return 403 when user lacks access to workspace", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [], // User is not a member
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Successful Chat Message Creation", () => {
    it("should create chat message successfully for workspace owner", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId, // User is the owner
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      const mockCreatedMessage = {
        id: "message-123",
        taskId: mockTaskId,
        message: "Test message",
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);
      mockDb.chatMessage.create.mockResolvedValue(mockCreatedMessage as any);

      // Mock task update for workflow status
      mockDb.task.update.mockResolvedValue({} as any);

      // Mock external API calls
      const { callMock } = require("@/services/mock/mock");
      callMock.mockResolvedValue({
        success: true,
        data: { workflow_id: "workflow-123" },
      });

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          contextTags: [],
          artifacts: [],
          attachments: [],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.id).toBe("message-123");
      expect(data.message.message).toBe("Test message");
      expect(data.message.role).toBe(ChatRole.USER);

      // Verify database operations
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: "Test message",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          artifacts: {
            create: [],
          },
          attachments: {
            create: [],
          },
        },
        include: {
          artifacts: true,
          attachments: true,
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    });

    it("should create chat message successfully for workspace member", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: "other-user",
          members: [{ role: "MEMBER" }], // User is a member
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      const mockCreatedMessage = {
        id: "message-456",
        taskId: mockTaskId,
        message: "Member test message",
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);
      mockDb.chatMessage.create.mockResolvedValue(mockCreatedMessage as any);
      mockDb.task.update.mockResolvedValue({} as any);

      const { callMock } = require("@/services/mock/mock");
      callMock.mockResolvedValue({
        success: true,
        data: { workflow_id: "workflow-456" },
      });

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Member test message",
          contextTags: [],
          artifacts: [],
          attachments: [],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe("Member test message");
    });
  });

  describe("External API Integration", () => {
    it("should handle Stakwork API integration when enabled", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      const mockCreatedMessage = {
        id: "message-789",
        taskId: mockTaskId,
        message: "Stakwork test message",
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);
      mockDb.chatMessage.create.mockResolvedValue(mockCreatedMessage as any);
      mockDb.task.update.mockResolvedValue({} as any);

      // Mock GitHub profile
      const { getGithubUsernameAndPAT } = require("@/lib/auth/nextauth");
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github_pat_test",
      });

      // Mock Stakwork API call
      const { callStakwork } = require("@/services/stakwork/stakwork");
      callStakwork.mockResolvedValue({
        success: true,
        data: {
          project_id: 12345,
          workflow_id: "stakwork-workflow-123",
        },
      });

      // Set environment variables for Stakwork integration
      const originalConfig = require("@/lib/config");
      jest.doMock("@/lib/config", () => ({
        ...originalConfig,
        STAKWORK_API_KEY: "test_stakwork_key",
        STAKWORK_BASE_URL: "https://stakwork.com/api",
        STAKWORK_WORKFLOW_ID: "test_workflow_id",
      }));

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Stakwork test message",
          contextTags: [{ type: "file", value: "test.js" }],
          artifacts: [],
          attachments: [],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow).toEqual({
        project_id: 12345,
        workflow_id: "stakwork-workflow-123",
      });

      // Verify task was updated with workflow status
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
        },
      });
    });

    it("should handle workflow failure and update task status", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      const mockCreatedMessage = {
        id: "message-fail",
        taskId: mockTaskId,
        message: "Failed message",
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);
      mockDb.chatMessage.create.mockResolvedValue(mockCreatedMessage as any);
      mockDb.task.update.mockResolvedValue({} as any);

      // Mock failed Stakwork API call
      const { callStakwork } = require("@/services/stakwork/stakwork");
      callStakwork.mockResolvedValue({
        success: false,
        error: "External API error",
      });

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Failed message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify task was updated with failed status
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: WorkflowStatus.FAILED,
        },
      });
    });
  });

  describe("Artifact and Attachment Handling", () => {
    it("should create message with artifacts and attachments", async () => {
      const mockTask = {
        workspaceId: mockWorkspaceId,
        workspace: {
          ownerId: mockUserId,
          members: [],
          swarm: {
            swarmUrl: "https://test-swarm.com/api",
            swarmSecretAlias: "test-secret",
            poolName: "test-pool",
            name: "Test Swarm",
            id: "swarm-123",
          },
        },
      };

      const mockUser = {
        id: mockUserId,
        name: "Test User",
      };

      const mockCreatedMessage = {
        id: "message-with-artifacts",
        taskId: mockTaskId,
        message: "Message with artifacts",
        role: ChatRole.USER,
        contextTags: "[]",
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        artifacts: [
          {
            id: "artifact-1",
            type: "CODE",
            content: { code: "console.log('test')" },
          },
        ],
        attachments: [
          {
            id: "attachment-1",
            path: "/uploads/test.pdf",
            filename: "test.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        ],
        task: {
          id: mockTaskId,
          title: "Test Task",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.task.findFirst.mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(mockUser as any);
      mockDb.chatMessage.create.mockResolvedValue(mockCreatedMessage as any);
      mockDb.task.update.mockResolvedValue({} as any);

      const { callMock } = require("@/services/mock/mock");
      callMock.mockResolvedValue({
        success: true,
        data: { workflow_id: "workflow-artifacts" },
      });

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Message with artifacts",
          artifacts: [
            {
              type: "CODE",
              content: { code: "console.log('test')" },
            },
          ],
          attachments: [
            {
              path: "/uploads/test.pdf",
              filename: "test.pdf",
              mimeType: "application/pdf",
              size: 1024,
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.artifacts).toHaveLength(1);
      expect(data.message.attachments).toHaveLength(1);
      expect(data.message.artifacts[0].type).toBe("CODE");
      expect(data.message.attachments[0].filename).toBe("test.pdf");

      // Verify database creation included artifacts and attachments
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: "Message with artifacts",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          sourceWebsocketID: undefined,
          replyId: undefined,
          artifacts: {
            create: [
              {
                type: "CODE",
                content: { code: "console.log('test')" },
              },
            ],
          },
          attachments: {
            create: [
              {
                path: "/uploads/test.pdf",
                filename: "test.pdf",
                mimeType: "application/pdf",
                size: 1024,
              },
            ],
          },
        },
        include: {
          artifacts: true,
          attachments: true,
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 500 on database error", async () => {
      mockDb.task.findFirst.mockRejectedValue(new Error("Database connection error"));

      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });

    it("should handle malformed JSON in request body", async () => {
      const request = new NextRequest("http://localhost/api/chat/message", {
        method: "POST",
        body: "invalid json {",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });
  });
});
