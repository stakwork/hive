import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";
import type { User, Workspace, Task, Swarm, ChatMessage } from "@prisma/client";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "workflowuser",
    pat: "workflow-pat-token",
    appAccessToken: "workflow-app-token",
  }),
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://workflow-s3.com/file"),
  })),
}));

// Mock Stakwork with more detailed responses
const mockStakworkCall = vi.fn();
const mockCallMock = vi.fn();

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "workflow-test-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com",
    STAKWORK_WORKFLOW_ID: "100,200,300",
  },
}));

const mockGetServerSession = vi.mocked(getServerSession);

describe("Chat Message Workflow Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testSwarm: Swarm;
  let testTask: Task;

  beforeAll(async () => {
    testUser = await db.user.create({
      data: {
        id: `workflow-user-${Date.now()}-${Math.random()}`,
        email: `workflow-user-${Date.now()}@example.com`,
        name: "Workflow Test User",
      },
    });

    testWorkspace = await db.workspace.create({
      data: {
        name: "Workflow Test Workspace",
        slug: `workflow-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        ownerId: testUser.id,
      },
    });

    testSwarm = await db.swarm.create({
      data: {
        name: `Workflow Test Swarm ${Date.now()}-${Math.random()}`,
        swarmUrl: "https://workflow-swarm.com/api",
        swarmSecretAlias: "workflow-secret",
        poolName: "workflow-pool",
        workspaceId: testWorkspace.id,
        status: "ACTIVE",
      },
    });

    testTask = await db.task.create({
      data: {
        title: "Workflow Test Task",
        description: "Task for testing workflow integration",
        status: "TODO",
        workspaceId: testWorkspace.id,
        workflowStatus: WorkflowStatus.PENDING,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });
  });

  afterAll(async () => {
    await db.chatMessage.deleteMany({ where: { taskId: testTask.id } });
    await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.swarm.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.deleteMany({ where: { ownerId: testUser.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    });
  });

  afterEach(async () => {
    await db.chatMessage.deleteMany({ where: { taskId: testTask.id } });
    await db.task.update({
      where: { id: testTask.id },
      data: {
        workflowStatus: WorkflowStatus.PENDING,
        workflowStartedAt: null,
        stakworkProjectId: null,
      },
    });
  });

  describe("Basic Workflow Tests", () => {
    test("should create a simple message", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: testTask.id,
          message: "Simple workflow test",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe("Simple workflow test");
    });
  });
});