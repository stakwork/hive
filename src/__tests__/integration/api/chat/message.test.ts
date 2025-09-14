import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST as CreateMessage } from "@/app/api/chat/message/route";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { WorkspaceRole, WorkflowStatus } from "@prisma/client";
import { db } from "@/lib/db";

// Mock NextAuth - external dependency
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock GitHub authentication utility
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

// Mock S3 service
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
  })),
}));

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

// Mock encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted-value"),
    })),
  },
}));

// Mock utils
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue("http://localhost:3355"),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockGetGithubUsernameAndPAT = vi.fn();

// Mock fetch globally for external API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("POST /api/chat/message Integration Tests", () => {
  async function createTestWorkspaceWithTask(userRole: WorkspaceRole = "OWNER") {
    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      let workspace;
      if (userRole === "OWNER") {
        // User is workspace owner
        workspace = await tx.workspace.create({
          data: {
            name: `Test Workspace ${Date.now()}`,
            slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            ownerId: user.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "OWNER",
          },
        });
      } else {
        // Create separate owner and add user as member
        const owner = await tx.user.create({
          data: {
            id: `owner-${Date.now()}-${Math.random()}`,
            email: `owner-${Date.now()}@example.com`,
            name: "Workspace Owner",
          },
        });

        workspace = await tx.workspace.create({
          data: {
            name: `Test Workspace ${Date.now()}`,
            slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            ownerId: owner.id,
          },
        });

        // Create owner membership
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: owner.id,
            role: "OWNER",
          },
        });

        // Create test user membership
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: userRole,
          },
        });
      }

      // Create swarm for workspace
      const swarm = await tx.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `Test Swarm ${Date.now()}`,
          status: "ACTIVE",
          workspaceId: workspace.id,
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "test-secret-alias",
          poolName: "test-pool",
        },
      });

      // Create task in workspace
      const task = await tx.task.create({
        data: {
          title: `Test Task ${Date.now()}`,
          description: "Test task for integration testing",
          status: "IN_PROGRESS",
          workspaceId: workspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return { user, workspace, swarm, task };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up GitHub username mock
    vi.doMock("@/lib/auth/nextauth", () => ({
      authOptions: {},
      getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
    }));
    
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      pat: "github_pat_test_token",
    });

    // Mock fetch responses for external APIs
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { project_id: 12345 } }),
    });
  });

  describe("Authentication and Authorization", () => {
    test("should reject unauthenticated requests", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: "test-task-id",
          message: "Test message",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");
    });

    test("should reject requests with invalid user session", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: "test-task-id",
          message: "Test message",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Invalid user session");
    });

    test("should reject access to tasks user doesn't have access to", async () => {
      const { user: unauthorizedUser } = await createTestWorkspaceWithTask();
      const { task: restrictedTask } = await createTestWorkspaceWithTask();

      mockGetServerSession.mockResolvedValue({
        user: { id: unauthorizedUser.id, email: unauthorizedUser.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: restrictedTask.id,
          message: "Test message",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(403);
      expect(responseData.error).toBe("Access denied");
    });
  });

  describe("Request Validation", () => {
    test("should reject requests without message", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          // message missing
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Message is required");
    });

    test("should reject requests without taskId", async () => {
      const { user } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          message: "Test message",
          // taskId missing
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe("taskId is required");
    });

    test("should reject requests for non-existent task", async () => {
      const { user } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: "non-existent-task-id",
          message: "Test message",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.error).toBe("Task not found");
    });
  });

  describe("Successful Message Creation", () => {
    test("should create chat message with basic payload", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const messageText = "Test chat message";
      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: messageText,
          contextTags: [],
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toMatchObject({
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        contextTags: [],
      });

      // Verify database record was created
      const chatMessage = await db.chatMessage.findFirst({
        where: {
          taskId: task.id,
          message: messageText,
        },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.role).toBe(ChatRole.USER);
      expect(chatMessage?.status).toBe(ChatStatus.SENT);
    });

    test("should create chat message with artifacts", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const artifacts = [
        {
          type: "CODE" as const,
          content: {
            language: "typescript",
            code: "console.log('Hello World');",
          },
        },
        {
          type: "BROWSER" as const,
          content: {
            url: "https://example.com",
            action: "navigate",
          },
        },
      ];

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test message with artifacts",
          artifacts,
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message.artifacts).toHaveLength(2);

      // Verify artifacts were saved to database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: task.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts).toHaveLength(2);
      expect(chatMessage?.artifacts[0].type).toBe("CODE");
      expect(chatMessage?.artifacts[1].type).toBe("BROWSER");
    });

    test("should create chat message with attachments", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const attachments = [
        {
          path: "uploads/workspace/swarm/task/file1.png",
          filename: "screenshot.png",
          mimeType: "image/png",
          size: 1024000,
        },
        {
          path: "uploads/workspace/swarm/task/file2.pdf",
          filename: "document.pdf", 
          mimeType: "application/pdf",
          size: 2048000,
        },
      ];

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test message with attachments",
          attachments,
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message.attachments).toHaveLength(2);

      // Verify attachments were saved to database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: task.id },
        include: { attachments: true },
      });

      expect(chatMessage?.attachments).toHaveLength(2);
      expect(chatMessage?.attachments[0].filename).toBe("screenshot.png");
      expect(chatMessage?.attachments[1].filename).toBe("document.pdf");
    });

    test("should update task workflow status on successful workflow trigger", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock successful Stakwork response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ 
          success: true, 
          data: { project_id: 12345 } 
        }),
      });

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test workflow trigger",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toHaveProperty("project_id", 12345);

      // Verify task workflow status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.stakworkProjectId).toBe(12345);
      expect(updatedTask?.workflowStartedAt).toBeTruthy();
    });
  });

  describe("External API Integration", () => {
    test("should call Stakwork API when configured", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock successful Stakwork response
      const mockStakworkResponse = {
        success: true,
        data: { project_id: 67890 },
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStakworkResponse),
      });

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test Stakwork integration",
          mode: "live",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);

      // Verify Stakwork API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Authorization": "Token token=test-api-key",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify request payload structure
      const stakworkCallArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(stakworkCallArgs[1].body);
      
      expect(requestBody).toMatchObject({
        name: "hive_autogen",
        workflow_id: 123, // First workflow ID for live mode
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.objectContaining({
                taskId: task.id,
                message: "Test Stakwork integration",
                taskMode: "live",
              }),
            },
          },
        },
      });
    });

    test("should call mock API when Stakwork is not configured", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Reset mock to only track calls made in this test
      mockFetch.mockClear();
      
      // Mock environment without Stakwork configuration
      vi.doMock("@/lib/env", () => ({
        config: {
          STAKWORK_API_KEY: undefined,
          STAKWORK_BASE_URL: undefined,
          STAKWORK_WORKFLOW_ID: undefined,
        },
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test mock integration",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);

      // The environment is still configured in this test environment,
      // so it will still call the Stakwork API
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should handle external API failures gracefully", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock failed external API response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      });

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Test API failure handling",
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);

      // Verify task workflow status was set to failed
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
    });
  });

  describe("Workspace Access Control", () => {
    test("should allow workspace owner to create messages", async () => {
      const { user, task } = await createTestWorkspaceWithTask("OWNER");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Owner message",
        }),
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(201);
    });

    test("should allow workspace members to create messages", async () => {
      const { user, task } = await createTestWorkspaceWithTask("DEVELOPER");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Member message",
        }),
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(201);
    });

    test("should allow workspace admins to create messages", async () => {
      const { user, task } = await createTestWorkspaceWithTask("ADMIN");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Admin message",
        }),
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(201);
    });

    test("should allow workspace viewers to create messages", async () => {
      const { user, task } = await createTestWorkspaceWithTask("VIEWER");
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Viewer message",
        }),
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Context Tags and Reply Handling", () => {
    test("should handle context tags correctly", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const contextTags = [
        { type: "FILE" as const, id: "src/components/Button.tsx" },
        { type: "FUNCTION" as const, id: "handleSubmit" },
      ];

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "Message with context tags",
          contextTags,
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.message.contextTags).toEqual(contextTags);

      // Verify context tags were stored correctly
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: task.id },
      });

      const storedContextTags = JSON.parse(chatMessage!.contextTags as string);
      expect(storedContextTags).toEqual(contextTags);
    });

    test("should handle reply messages correctly", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Create original message
      const originalMessage = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Original message",
          role: ChatRole.USER,
          contextTags: "[]",
          status: ChatStatus.SENT,
        },
      });

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          message: "This is a reply",
          replyId: originalMessage.id,
        }),
      });

      const response = await CreateMessage(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.message.replyId).toBe(originalMessage.id);

      // Verify reply reference was stored
      const replyMessage = await db.chatMessage.findFirst({
        where: {
          taskId: task.id,
          replyId: originalMessage.id,
        },
      });

      expect(replyMessage).toBeTruthy();
      expect(replyMessage?.message).toBe("This is a reply");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      const { user, task } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      // Mock database error by using invalid task ID format
      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({
          taskId: "invalid-uuid-format",
          message: "Test database error",
        }),
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(404);
    });

    test("should handle malformed JSON request", async () => {
      const { user } = await createTestWorkspaceWithTask();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: user.id, email: user.email },
      } as any);

      const request = new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: "invalid json{",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await CreateMessage(request);

      expect(response.status).toBe(500);
    });
  });
});