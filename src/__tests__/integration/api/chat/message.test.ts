import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { 
  ChatRole, 
  ChatStatus, 
  ArtifactType, 
  WorkflowStatus, 
  type ChatMessage, 
  type Artifact 
} from "@/lib/chat";
import type { User, Workspace, Task, Swarm } from "@prisma/client";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "testuser",
    pat: "mock-pat-token",
    appAccessToken: "mock-app-token",
  }),
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://mock-s3-url.com/file"),
  })),
}));

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: null, // Disable Stakwork for simplified tests
    STAKWORK_BASE_URL: null,
    STAKWORK_WORKFLOW_ID: null,
  },
}));

// Mock the fetch function globally
global.fetch = vi.fn();

const mockGetServerSession = vi.mocked(getServerSession);

describe("Chat Message Creation Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace; 
  let testSwarm: Swarm;
  let testTask: Task;

  beforeAll(async () => {
    // Clean up any existing test data first
    await db.chatMessage.deleteMany({
      where: {
        message: { contains: "test" }
      }
    });
    
    // Set up test data that persists across tests
    testUser = await db.user.create({
      data: {
        id: `test-user-${Date.now()}-${Math.random()}`,
        email: `test-user-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        ownerId: testUser.id,
      },
    });

    testSwarm = await db.swarm.create({
      data: {
        name: `Test Swarm ${Date.now()}-${Math.random()}`,
        swarmUrl: "https://test-swarm.com/api",
        swarmSecretAlias: "test-secret",
        poolName: "test-pool",
        workspaceId: testWorkspace.id,
        status: "ACTIVE",
      },
    });

    testTask = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test task description",
        status: "TODO",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });
    
    // Verify test data was created
    const verifyWorkspace = await db.workspace.findUnique({ 
      where: { id: testWorkspace.id } 
    });
    const verifyTask = await db.task.findUnique({ 
      where: { id: testTask.id } 
    });
    
    if (!verifyWorkspace || !verifyTask) {
      throw new Error("Failed to create test data properly");
    }
  });

  afterAll(async () => {
    // Clean up test data in proper order to avoid foreign key issues
    if (testTask?.id) {
      await db.chatMessage.deleteMany({ where: { taskId: testTask.id } });
    }
    if (testWorkspace?.id) {
      await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });
    }
    if (testUser?.id) {
      await db.workspace.deleteMany({ where: { ownerId: testUser.id } });
      await db.user.deleteMany({ where: { id: testUser.id } });
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any messages and workspace members created during tests
    if (testTask?.id) {
      await db.chatMessage.deleteMany({
        where: { taskId: testTask.id },
      });
    }
    if (testWorkspace?.id) {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
    }
  });

  describe("Basic Message Creation", () => {
    test("should create a simple chat message successfully", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Simple test message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.message).toBe("Simple test message");
    });
  });

  describe("Authentication and Permission Errors", () => {
    test("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when user session is invalid", async () => {
      mockGetServerSession.mockResolvedValue({
        user: {}, // Missing required id field
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });

    test("should return 403 when user lacks workspace access", async () => {
      // Create unauthorized user
      const unauthorizedUser = await db.user.create({
        data: {
          id: `unauthorized-${Date.now()}-${Math.random()}`,
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
          message: "Test unauthorized message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");

      // Clean up
      await db.user.delete({ where: { id: unauthorizedUser.id } });
    });

    test("should allow workspace members to create messages", async () => {
      // Create member user
      const memberUser = await db.user.create({
        data: {
          id: `member-${Date.now()}-${Math.random()}`,
          email: `member-${Date.now()}@example.com`,
          name: "Member User",
        },
      });

      // Ensure workspace exists before creating workspace member
      const workspaceExists = await db.workspace.findUnique({ 
        where: { id: testWorkspace.id } 
      });
      
      if (!workspaceExists) {
        throw new Error(`Workspace ${testWorkspace.id} does not exist`);
      }

      // Add as workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: memberUser.id, email: memberUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test member message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Clean up
      await db.workspaceMember.deleteMany({ where: { userId: memberUser.id } });
      await db.user.delete({ where: { id: memberUser.id } });
    });
  });

  describe("Validation Errors", () => {
    test("should return 400 when message is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          // Missing message field
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Message is required");
    });

    test("should return 400 when taskId is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          message: "Test message",
          // Missing taskId field
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("taskId is required");
    });

    test("should return 404 when task does not exist", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: "nonexistent-task-id",
          message: "Test message",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });
  });

  describe("External Service Failures", () => {
    test("should handle S3 service failure gracefully", async () => {
      // Mock S3 service failure
      const s3Service = (await import("@/services/s3")).getS3Service();
      vi.mocked(s3Service.generatePresignedDownloadUrl).mockRejectedValue(
        new Error("S3 service unavailable")
      );

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test S3 failure",
          attachments: [
            {
              path: "uploads/test/file.png",
              filename: "test.png",
              mimeType: "image/png",
              size: 1024,
            },
          ],
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      // Should fail gracefully with 500 error
      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat message");
    });
  });

  describe("Mock Service Integration", () => {
    test("should use mock service when Stakwork is not configured", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Test mock service",
        }),
        headers: { 
          "Content-Type": "application/json",
          "host": "localhost:3000",
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Since we've mocked Stakwork to be null, it should fall back to mock service
      expect(data.message.message).toBe("Test mock service");
    });
  });

  describe("Complex Workflow Integration", () => {
    test("should handle message with artifacts and attachments", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const requestBody = {
        taskId: testTask.id,
        message: "Message with artifacts and attachments",
        contextTags: [
          { type: "file", id: "/src/component.tsx" },
          { type: "function", id: "handleSubmit" },
        ],
        artifacts: [
          {
            type: "CODE" as ArtifactType,
            content: {
              content: 'function handleSubmit() {\n  console.log("submitted");\n}',
              language: "javascript",
              file: "component.tsx",
            },
          },
        ],
        attachments: [
          {
            path: "uploads/workspace/debug-screenshot.png",
            filename: "debug.png",
            mimeType: "image/png",
            size: 4096,
          },
        ],
      };

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify complete message structure
      const message = data.message;
      expect(message.contextTags).toHaveLength(2);
      expect(message.artifacts).toHaveLength(1);
      expect(message.attachments).toHaveLength(1);

      // Verify artifact type
      expect(message.artifacts.find((a: Artifact) => a.type === "CODE")).toBeTruthy();
    });
  });
});