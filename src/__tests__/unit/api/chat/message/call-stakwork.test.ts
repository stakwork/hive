import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import { getS3Service } from "@/services/s3";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import {
  DEFAULT_MOCK_IDS,
  createMockTask,
  createMockChatMessage,
  setupChatMessageDatabaseMocks,
  createMockStakworkSuccessResponse,
  createMockStakworkErrorResponse,
} from "@/__tests__/support/helpers/chat-message-mocks";

// Mock all external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/auth/nextauth");
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
    workspace: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/config/env");
vi.mock("@/services/s3");
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(),
  cn: vi.fn(),
  getRelativeUrl: vi.fn(),
}));
vi.mock("@/lib/utils/swarm");

/**
 * Unit Tests for callStakwork Function (Chat Message Variant)
 * 
 * Tests the callStakwork function which is central to the chat message processing
 * workflow. This function integrates with the Stakwork AI service to trigger
 * automated workflows based on user chat messages.
 * 
 * Test Coverage:
 * 1. Chat Message Processing - message creation, status updates, AI workflow trigger
 * 2. Context Tag Handling - serialization, validation, passing to external API
 * 3. Authentication - session validation, workspace access control
 * 4. External Service Integration - Stakwork API calls, error handling, mode selection
 */
describe("callStakwork Function - Chat Message Processing", () => {
  const mockUserId = "user-123";
  const mockTaskId = "task-456";
  const mockWorkspaceId = "workspace-789";
  const mockMessageId = "message-abc";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup authenticated session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: mockUserId, name: "Test User", email: "test@example.com" },
    } as any);

    // Setup default config
    vi.mocked(config).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(config).STAKWORK_BASE_URL = "https://stakwork.test.com/api";
    vi.mocked(config).STAKWORK_WORKFLOW_ID = "101,102,103"; // live,test,unit/integration

    // Mock utility functions
    vi.mocked(getBaseUrl).mockReturnValue("http://localhost:3000");
    vi.mocked(transformSwarmUrlToRepo2Graph).mockReturnValue("http://test-swarm.com:3355");

    // Mock S3 service
    vi.mocked(getS3Service).mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.test.com/file"),
    } as any);

    // Mock GitHub credentials
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "github_pat_test",
    } as any);

    // Mock chat history as empty
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Chat Message Processing", () => {
    describe("Message Creation and Status Lifecycle", () => {
      it("should create chat message with SENT status before triggering workflow", async () => {
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

        const mockUser = { id: mockUserId, name: "Test User" };
        const mockWorkspace = { id: mockWorkspaceId, slug: "test-workspace" };

        const mockCreatedMessage = {
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test message",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        };

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        
        // Verify chat message was created with correct status
        expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalledWith({
          data: expect.objectContaining({
            taskId: mockTaskId,
            message: "Test message",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
          }),
          include: expect.any(Object),
        });
      });

      it("should update task workflow status to IN_PROGRESS on successful Stakwork call", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 67890 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        await POST(request);

        // Verify task was updated with IN_PROGRESS status and stakworkProjectId
        expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
          where: { id: mockTaskId },
          data: {
            workflowStatus: WorkflowStatus.IN_PROGRESS,
            workflowStartedAt: expect.any(Date),
            stakworkProjectId: 67890,
          },
        });
      });

      it("should update task workflow status to FAILED when Stakwork API returns error", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: false,
          statusText: "Internal Server Error",
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(201); // Message still created
        
        // Verify task was marked as FAILED
        expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
          where: { id: mockTaskId },
          data: {
            workflowStatus: WorkflowStatus.FAILED,
          },
        });
      });

      it("should handle artifacts and attachments in chat message", async () => {
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

        const mockCreatedMessage = {
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test with artifacts",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [
            {
              id: "artifact-1",
              type: ArtifactType.CODE,
              content: { language: "javascript", code: "console.log('test')" },
            },
          ],
          attachments: [
            {
              id: "attachment-1",
              path: "uploads/file.pdf",
              filename: "file.pdf",
              mimeType: "application/pdf",
              size: 1024,
            },
          ],
          task: { id: mockTaskId, title: "Test Task" },
        };

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test with artifacts",
            artifacts: [
              {
                type: ArtifactType.CODE,
                content: { language: "javascript", code: "console.log('test')" },
              },
            ],
            attachments: [
              {
                path: "uploads/file.pdf",
                filename: "file.pdf",
                mimeType: "application/pdf",
                size: 1024,
              },
            ],
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.message.artifacts).toHaveLength(1);
        expect(data.message.attachments).toHaveLength(1);
      });
    });

    describe("AI Workflow Trigger", () => {
      it("should return workflow data with project_id on successful trigger", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              project_id: 12345,
              workflow_id: "workflow-abc",
            },
          }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.workflow).toEqual({
          project_id: 12345,
          workflow_id: "workflow-abc",
        });
      });
    });
  });

  describe("2. Context Tag Handling", () => {
    describe("Context Tag Serialization and Validation", () => {
      it("should serialize context tags to JSON for database storage", async () => {
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

        const contextTags = [
          { type: "PRODUCT_BRIEF", id: "brief-123" },
          { type: "FEATURE_BRIEF", id: "feature-456" },
        ];

        const mockCreatedMessage = {
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test message",
          role: ChatRole.USER,
          contextTags: JSON.stringify(contextTags),
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        };

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue(mockCreatedMessage as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            contextTags,
          }),
        });

        await POST(request);

        // Verify context tags were serialized to JSON string for database
        expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalledWith({
          data: expect.objectContaining({
            contextTags: JSON.stringify(contextTags),
          }),
          include: expect.any(Object),
        });
      });

      it("should pass context tags to Stakwork API payload", async () => {
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

        const contextTags = [
          { type: "SCHEMATIC", id: "diagram-789" },
        ];

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: JSON.stringify(contextTags),
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            contextTags,
          }),
        });

        await POST(request);

        // Verify context tags were passed to Stakwork API
        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);
        const vars = requestBody.workflow_params.set_var.attributes.vars;

        expect(vars.contextTags).toEqual(contextTags);
      });

      it("should handle empty context tags array", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            contextTags: [],
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.message.contextTags).toEqual([]);
      });
    });
  });

  describe("3. Authentication and Authorization", () => {
    describe("Session Validation", () => {
      it("should reject requests without authentication session", async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

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

      it("should reject requests with session but no user", async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: null } as any);

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

      it("should reject requests with user but no user ID", async () => {
        vi.mocked(getServerSession).mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
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

    describe("Workspace Access Control", () => {
      it("should allow workspace owner to trigger callStakwork", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(201);
      });

      it("should allow workspace member to trigger callStakwork", async () => {
        const mockTask = {
          workspaceId: mockWorkspaceId,
          workspace: {
            ownerId: "other-user-id",
            members: [{ userId: mockUserId, role: "DEVELOPER" }],
            swarm: {
              swarmUrl: "https://test-swarm.com/api",
              swarmSecretAlias: "test-secret",
              poolName: "test-pool",
              name: "Test Swarm",
              id: "swarm-123",
            },
          },
        };

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(201);
      });

      it("should reject users without workspace access", async () => {
        const mockTask = {
          workspaceId: mockWorkspaceId,
          workspace: {
            ownerId: "other-user-id",
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);

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
  });

  describe("4. External Service Integration", () => {
    describe("Stakwork API Configuration", () => {
      it("should validate STAKWORK_API_KEY is present", async () => {
        vi.mocked(config).STAKWORK_API_KEY = "";

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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: {} }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(201);
        // Should use mock service when Stakwork config is missing
        expect(mockFetch).toHaveBeenCalledWith(
          "http://localhost:3000/api/mock/chat",
          expect.objectContaining({
            method: "POST",
          })
        );
      });

      it("should call Stakwork API with correct configuration", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        await POST(request);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://stakwork.test.com/api/projects",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: "Token token=test-api-key",
              "Content-Type": "application/json",
            }),
          })
        );
      });
    });

    describe("Mode-Based Workflow Selection", () => {
      const setupMocks = () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);
      };

      it("should use first workflow ID for live mode", async () => {
        setupMocks();

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            mode: "live",
          }),
        });

        await POST(request);

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);

        expect(requestBody.workflow_id).toBe(101); // First ID from "101,102,103"
      });

      it("should use third workflow ID for unit mode", async () => {
        setupMocks();

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            mode: "unit",
          }),
        });

        await POST(request);

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);

        expect(requestBody.workflow_id).toBe(103); // Third ID from "101,102,103"
      });

      it("should use second workflow ID for test mode (default)", async () => {
        setupMocks();

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            mode: "test",
          }),
        });

        await POST(request);

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);

        expect(requestBody.workflow_id).toBe(102); // Second ID from "101,102,103"
      });
    });

    describe("Error Handling and Fault Tolerance", () => {
      it("should handle network failures gracefully", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        // Message is still created (fault-tolerant)
        expect(response.status).toBe(201);
        expect(data.success).toBe(true);

        // Task marked as FAILED
        expect(vi.mocked(db.task.update)).toHaveBeenCalledWith({
          where: { id: mockTaskId },
          data: {
            workflowStatus: WorkflowStatus.FAILED,
          },
        });
      });

      it("should create message even when Stakwork API fails", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test message",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: false,
          statusText: "Service Unavailable",
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        // Verify chat message was still created
        expect(vi.mocked(db.chatMessage.create)).toHaveBeenCalled();
        expect(response.status).toBe(201);
        expect(data.success).toBe(true);
        expect(data.message.message).toBe("Test message");
      });
    });

    describe("Payload Construction", () => {
      it("should construct complete vars object with all required fields", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            contextTags: [{ type: "PRODUCT_BRIEF", id: "brief-123" }],
            mode: "live",
          }),
        });

        await POST(request);

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);
        const vars = requestBody.workflow_params.set_var.attributes.vars;

        expect(vars).toMatchObject({
          taskId: mockTaskId,
          message: "Test message",
          alias: "testuser",
          username: "testuser",
          accessToken: "github_pat_test",
          swarmUrl: "https://test-swarm.com:8444/api",
          swarmSecretAlias: "test-secret",
          poolName: "swarm-123",
          taskMode: "live",
          workspaceId: mockWorkspaceId,
        });

        expect(vars.contextTags).toEqual([{ type: "PRODUCT_BRIEF", id: "brief-123" }]);
        expect(vars.webhookUrl).toContain("/api/chat/response");
        expect(vars.repo2graph_url).toBe("http://test-swarm.com:3355");
      });

      it("should include webhook URL in payload", async () => {
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

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
          }),
        });

        await POST(request);

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);

        expect(requestBody.webhook_url).toBe(
          `http://localhost:3000/api/stakwork/webhook?task_id=${mockTaskId}`
        );
      });

      it("should generate presigned URLs for attachments", async () => {
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

        const mockS3Service = {
          generatePresignedDownloadUrl: vi
            .fn()
            .mockResolvedValueOnce("https://s3.test.com/file1.pdf")
            .mockResolvedValueOnce("https://s3.test.com/file2.jpg"),
        };

        vi.mocked(getS3Service).mockReturnValue(mockS3Service as any);

        vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
        vi.mocked(db.user.findUnique).mockResolvedValue({ id: mockUserId, name: "Test User" } as any);
        vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: mockWorkspaceId, slug: "test-workspace" } as any);
        vi.mocked(db.chatMessage.create).mockResolvedValue({
          id: mockMessageId,
          taskId: mockTaskId,
          message: "Test",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [
            { id: "att-1", path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
            { id: "att-2", path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
          ],
          task: { id: mockTaskId, title: "Test Task" },
        } as any);
        vi.mocked(db.task.update).mockResolvedValue({} as any);

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, data: { project_id: 12345 } }),
        } as Response);

        const request = new NextRequest("http://localhost/api/chat/message", {
          method: "POST",
          body: JSON.stringify({
            taskId: mockTaskId,
            message: "Test message",
            attachments: [
              { path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
              { path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
            ],
          }),
        });

        await POST(request);

        // Verify S3 service was called for each attachment
        expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledTimes(2);
        expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file1.pdf");
        expect(mockS3Service.generatePresignedDownloadUrl).toHaveBeenCalledWith("uploads/file2.jpg");

        const fetchCall = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(fetchCall[1].body as string);
        const vars = requestBody.workflow_params.set_var.attributes.vars;

        expect(vars.attachments).toEqual([
          "https://s3.test.com/file1.pdf",
          "https://s3.test.com/file2.jpg",
        ]);
      });
    });
  });
});
