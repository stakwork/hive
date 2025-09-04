import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/chat/message/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus, Priority, TaskStatus } from "@prisma/client";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock fetch for external API calls
global.fetch = vi.fn();

// Mock S3 service
vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
  }),
}));

// Mock auth utilities
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "testuser",
    pat: "github_pat_test_token",
  }),
}));

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test_stakwork_key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockFetch = global.fetch as vi.MockedFunction<typeof fetch>;

describe("POST /api/chat/message Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithWorkspace() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace owned by user
      const testWorkspace = await tx.workspace.create({
        data: {
          id: `test-workspace-${Date.now()}-${Math.random()}`,
          name: "Test Workspace",
          description: "Test workspace description",
          slug: `test-workspace-${Date.now()}`,
          ownerId: testUser.id,
          stakworkApiKey: "test_api_key",
        },
      });

      // Create swarm for workspace
      const testSwarm = await tx.swarm.create({
        data: {
          id: `test-swarm-${Date.now()}-${Math.random()}`,
          swarmId: "test-swarm-123",
          name: "Test Swarm",
          status: "ACTIVE",
          workspaceId: testWorkspace.id,
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          instanceType: "M",
          repositoryName: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          defaultBranch: "main",
          environmentVariables: [],
          services: [],
          wizardStep: "COMPLETION",
          stepStatus: "COMPLETED",
        },
      });

      // Create test task
      const testTask = await tx.task.create({
        data: {
          id: `test-task-${Date.now()}-${Math.random()}`,
          title: "Test Task",
          description: "Test task description",
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testSwarm, testTask };
    });
  }

  async function createWorkspaceMember(workspaceId: string) {
    const memberUser = await db.user.create({
      data: {
        id: `member-user-${Date.now()}-${Math.random()}`,
        email: `member-${Date.now()}@example.com`,
        name: "Member User",
      },
    });

    await db.workspaceMember.create({
      data: {
        userId: memberUser.id,
        workspaceId: workspaceId,
        role: "MEMBER",
      },
    });

    return memberUser;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication and Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: "test-task-id",
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("should return 401 for invalid user session", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: "test-task-id",
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Invalid user session" });
    });

    test("should return 403 for user without workspace access", async () => {
      const { testTask } = await createTestUserWithWorkspace();
      
      // Create different user without access to workspace
      const unauthorizedUser = await db.user.create({
        data: {
          id: `unauthorized-user-${Date.now()}`,
          email: `unauthorized-${Date.now()}@example.com`,
          name: "Unauthorized User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: unauthorizedUser.id, email: unauthorizedUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({ error: "Access denied" });
    });
  });

  describe("Workspace Membership Enforcement", () => {
    test("should allow workspace owner to create chat messages", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful Stakwork response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 12345 },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message from owner",
          contextTags: [],
          mode: "test",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe("Test message from owner");
      expect(data.message.role).toBe(ChatRole.USER);
      expect(data.message.status).toBe(ChatStatus.SENT);
    });

    test("should allow workspace member to create chat messages", async () => {
      const { testWorkspace, testTask } = await createTestUserWithWorkspace();
      const memberUser = await createWorkspaceMember(testWorkspace.id);

      mockGetServerSession.mockResolvedValue({
        user: { id: memberUser.id, email: memberUser.email },
      });

      // Mock successful mock service response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message from member",
          contextTags: [],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe("Test message from member");
    });
  });

  describe("Chat Message Creation and Data Persistence", () => {
    test("should create chat message with artifacts and attachments", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 12345 },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message with artifacts",
          contextTags: [{ tag: "urgent", value: "high" }],
          artifacts: [
            {
              type: ArtifactType.CODE,
              content: { code: "console.log('test')", language: "javascript" },
            },
          ],
          attachments: [
            {
              path: "uploads/test/file.jpg",
              filename: "test-image.jpg",
              mimeType: "image/jpeg",
              size: 12345,
            },
          ],
          mode: "test",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify message was created in database
      const createdMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true, attachments: true },
      });

      expect(createdMessage).toBeTruthy();
      expect(createdMessage!.message).toBe("Test message with artifacts");
      expect(createdMessage!.role).toBe(ChatRole.USER);
      expect(createdMessage!.status).toBe(ChatStatus.SENT);
      expect(JSON.parse(createdMessage!.contextTags as string)).toEqual([
        { tag: "urgent", value: "high" },
      ]);

      // Verify artifact was created
      expect(createdMessage!.artifacts).toHaveLength(1);
      expect(createdMessage!.artifacts[0].type).toBe(ArtifactType.CODE);
      
      // Verify attachment was created
      expect(createdMessage!.attachments).toHaveLength(1);
      expect(createdMessage!.attachments[0].filename).toBe("test-image.jpg");
      expect(createdMessage!.attachments[0].path).toBe("uploads/test/file.jpg");
    });

    test("should update task workflow status on successful Stakwork integration", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful Stakwork response with project ID
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 98765 },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test workflow update",
          mode: "live",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);

      // Verify task workflow status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask!.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask!.workflowStartedAt).toBeDefined();
      expect(updatedTask!.stakworkProjectId).toBe(98765);
    });
  });

  describe("Stakwork Integration", () => {
    test("should successfully integrate with Stakwork API", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful Stakwork API response
      const mockStakworkResponse = {
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 55555, workflow_id: 123 },
        }),
      };
      mockFetch.mockResolvedValue(mockStakworkResponse as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test Stakwork integration",
          mode: "live",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow.project_id).toBe(55555);

      // Verify Stakwork API was called with correct payload
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test_stakwork_key",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify payload structure
      const stakworkCall = mockFetch.mock.calls.find(call => 
        call[0] === "https://api.stakwork.com/api/v1/projects"
      );
      expect(stakworkCall).toBeDefined();
      
      const payload = JSON.parse(stakworkCall![1]!.body as string);
      expect(payload.name).toBe("hive_autogen");
      expect(payload.workflow_id).toBe(123); // First workflow ID for live mode
      expect(payload.webhook_url).toContain("/api/stakwork/webhook");
      expect(payload.workflow_params.set_var.attributes.vars).toEqual(
        expect.objectContaining({
          taskId: testTask.id,
          message: "Test Stakwork integration",
          taskMode: "live",
        })
      );
    });

    test("should handle Stakwork API failures gracefully", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock failed Stakwork API response
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test Stakwork failure",
          mode: "test",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201); // Chat message creation should still succeed
      expect(data.success).toBe(true);

      // Verify task workflow status was set to FAILED
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask!.workflowStatus).toBe(WorkflowStatus.FAILED);
    });

    test("should select correct workflow ID based on mode", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 111 } }),
      } as Response);

      // Test unit mode (should use third workflow ID)
      const unitRequest = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test unit mode",
          mode: "unit",
        }),
      });

      await POST(unitRequest);

      const unitCall = mockFetch.mock.calls.find(call => 
        call[0] === "https://api.stakwork.com/api/v1/projects"
      );
      const unitPayload = JSON.parse(unitCall![1]!.body as string);
      expect(unitPayload.workflow_id).toBe(789); // Third workflow ID

      mockFetch.mockClear();

      // Test integration mode (should use third workflow ID)
      const integrationRequest = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test integration mode",
          mode: "integration",
        }),
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 222 } }),
      } as Response);

      await POST(integrationRequest);

      const integrationCall = mockFetch.mock.calls.find(call => 
        call[0] === "https://api.stakwork.com/api/v1/projects"
      );
      const integrationPayload = JSON.parse(integrationCall![1]!.body as string);
      expect(integrationPayload.workflow_id).toBe(789); // Third workflow ID
    });
  });

  describe("Mock Service Integration", () => {
    test("should fallback to mock service when Stakwork is not configured", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Temporarily mock config without Stakwork settings
      vi.mocked(config).STAKWORK_API_KEY = "";
      
      // Mock successful mock service response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: "Mock response generated" }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test mock service",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Reset config
      vi.mocked(config).STAKWORK_API_KEY = "test_stakwork_key";
    });

    test("should handle mock service failures", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Disable Stakwork
      vi.mocked(config).STAKWORK_API_KEY = "";

      // Mock failed mock service response
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Mock Service Error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test mock failure",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Chat message creation should still succeed even if mock service fails
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Reset config
      vi.mocked(config).STAKWORK_API_KEY = "test_stakwork_key";
    });
  });

  describe("Input Validation and Error Handling", () => {
    test("should return 400 for missing message", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          // message is missing
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: "Message is required" });
    });

    test("should return 400 for missing taskId", async () => {
      const { testUser } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          message: "Test message",
          // taskId is missing
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: "taskId is required" });
    });

    test("should return 404 for non-existent task", async () => {
      const { testUser } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: "non-existent-task-id",
          message: "Test message",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "Task not found" });
    });

    test("should handle database errors gracefully", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock database error by providing invalid data structure
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message",
          artifacts: [
            {
              type: "INVALID_TYPE", // Invalid artifact type
              content: { invalid: "data" },
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Failed to create chat message" });
    });
  });

  describe("Attachments and S3 Integration", () => {
    test("should handle attachments with S3 presigned URLs", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Mock successful Stakwork response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 77777 },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test with attachments",
          attachments: [
            {
              path: "uploads/workspace/task/image1.jpg",
              filename: "screenshot.jpg",
              mimeType: "image/jpeg",
              size: 256000,
            },
            {
              path: "uploads/workspace/task/document.pdf",
              filename: "requirements.pdf", 
              mimeType: "application/pdf",
              size: 1024000,
            },
          ],
          mode: "test",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);

      // Verify attachments were created in database
      const createdMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { attachments: true },
      });

      expect(createdMessage!.attachments).toHaveLength(2);
      expect(createdMessage!.attachments[0].filename).toBe("screenshot.jpg");
      expect(createdMessage!.attachments[1].filename).toBe("requirements.pdf");

      // Verify Stakwork was called with presigned URLs in payload
      const stakworkCall = mockFetch.mock.calls.find(call => 
        call[0] === "https://api.stakwork.com/api/v1/projects"
      );
      const payload = JSON.parse(stakworkCall![1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([
        "https://s3.example.com/presigned-url",
        "https://s3.example.com/presigned-url",
      ]);
    });
  });

  describe("Workflow Mode Selection", () => {
    test("should pass through mode parameter to services", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspace();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 999 } }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test mode parameter",
          mode: "integration",
        }),
      });

      await POST(request);

      // Verify mode was passed to Stakwork payload
      const stakworkCall = mockFetch.mock.calls.find(call => 
        call[0] === "https://api.stakwork.com/api/v1/projects"
      );
      const payload = JSON.parse(stakworkCall![1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.taskMode).toBe("integration");
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.chatMessage.deleteMany({
      where: {
        task: {
          title: { startsWith: "Test" },
        },
      },
    });

    await db.task.deleteMany({
      where: {
        title: { startsWith: "Test" },
      },
    });

    await db.swarm.deleteMany({
      where: {
        name: { startsWith: "Test" },
      },
    });

    await db.workspaceMember.deleteMany({
      where: {
        workspace: {
          name: { startsWith: "Test" },
        },
      },
    });

    await db.workspace.deleteMany({
      where: {
        name: { startsWith: "Test" },
      },
    });

    await db.user.deleteMany({
      where: {
        name: { startsWith: "Test" },
      },
    });

    await db.user.deleteMany({
      where: {
        name: { startsWith: "Member" },
      },
    });

    await db.user.deleteMany({
      where: {
        name: { startsWith: "Unauthorized" },
      },
    });
  });
});