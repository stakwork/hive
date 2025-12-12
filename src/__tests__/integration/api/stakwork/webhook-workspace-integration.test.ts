import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stakwork/webhook/route";
import { db } from "@/lib/db";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Mock Pusher while keeping other imports real
vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: {
      trigger: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("Stakwork Webhook - Workspace Broadcast Integration", () => {
  let testWorkspace: any;
  let testUser: any;
  let testTask: any;

  beforeEach(async () => {
    // Clear Pusher mocks
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        email: "webhook-test@example.com",
        name: "Webhook Test User",
      },
    });

    // Create test workspace with ownerId
    testWorkspace = await db.workspace.create({
      data: {
        name: "Webhook Test Workspace",
        slug: `webhook-test-${Date.now()}`,
        ownerId: testUser.id,
        members: {
          create: {
            userId: testUser.id,
            role: "OWNER",
          },
        },
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: "Integration Test Task",
        description: "Test task for workspace broadcast",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.PENDING,
      },
    });
  });

  afterEach(async () => {
    // Cleanup in reverse order of dependencies
    if (testTask) {
      await db.task.deleteMany({
        where: { id: testTask.id },
      });
    }

    if (testWorkspace) {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
      await db.workspace.delete({
        where: { id: testWorkspace.id },
      });
    }

    if (testUser) {
      await db.user.delete({
        where: { id: testUser.id },
      });
    }
  });

  const createMockRequest = (body: object) => {
    const url = new URL("http://localhost:3000/api/stakwork/webhook");
    return {
      url: url.toString(),
      json: vi.fn().mockResolvedValue(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  };

  it("should broadcast to both channels with correct workspace data from database", async () => {
    const request = createMockRequest({
      project_status: "in_progress",
      task_id: testTask.id,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);

    // Verify database was updated
    const updatedTask = await db.task.findUnique({
      where: { id: testTask.id },
      include: {
        workspace: {
          select: { slug: true, id: true },
        },
      },
    });

    expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    expect(updatedTask?.workspace?.slug).toBe(testWorkspace.slug);

    // Verify both Pusher broadcasts occurred
    expect(pusherServer.trigger).toHaveBeenCalledTimes(2);

    // Verify task channel broadcast
    expect(pusherServer.trigger).toHaveBeenCalledWith(
      getTaskChannelName(testTask.id),
      PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      expect.objectContaining({
        taskId: testTask.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      })
    );

    // Verify workspace channel broadcast with full payload
    expect(pusherServer.trigger).toHaveBeenCalledWith(
      getWorkspaceChannelName(testWorkspace.slug),
      PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      expect.objectContaining({
        taskId: testTask.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        taskTitle: testTask.title,
        workspaceId: testWorkspace.id,
      })
    );
  });

  it("should handle multiple status transitions with workspace broadcasts", async () => {
    // First transition: PENDING -> IN_PROGRESS
    const request1 = createMockRequest({
      project_status: "in_progress",
      task_id: testTask.id,
    });

    await POST(request1);

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      getWorkspaceChannelName(testWorkspace.slug),
      PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      expect.objectContaining({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      })
    );

    vi.clearAllMocks();

    // Second transition: IN_PROGRESS -> COMPLETED
    const request2 = createMockRequest({
      project_status: "completed",
      task_id: testTask.id,
    });

    await POST(request2);

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      getWorkspaceChannelName(testWorkspace.slug),
      PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
      expect.objectContaining({
        workflowStatus: WorkflowStatus.COMPLETED,
      })
    );

    // Verify final database state
    const finalTask = await db.task.findUnique({
      where: { id: testTask.id },
    });

    expect(finalTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    expect(finalTask?.workflowStartedAt).toBeTruthy();
    expect(finalTask?.workflowCompletedAt).toBeTruthy();
  });

  it("should include correct workspace relation in query result", async () => {
    const request = createMockRequest({
      project_status: "completed",
      task_id: testTask.id,
    });

    await POST(request);

    // Verify the workspace channel was called with the correct slug
    const workspaceBroadcastCall = vi.mocked(pusherServer.trigger).mock.calls.find(
      (call) => call[0].includes("workspace-")
    );

    expect(workspaceBroadcastCall).toBeDefined();
    expect(workspaceBroadcastCall![0]).toBe(getWorkspaceChannelName(testWorkspace.slug));

    const payload = workspaceBroadcastCall![2];
    expect(payload.workspaceId).toBe(testWorkspace.id);
    expect(payload.taskTitle).toBe(testTask.title);
  });

  it("should maintain consistency between task and workspace broadcasts", async () => {
    const request = createMockRequest({
      project_status: "failed",
      task_id: testTask.id,
    });

    await POST(request);

    const taskBroadcast = vi.mocked(pusherServer.trigger).mock.calls.find(
      (call) => call[0] === getTaskChannelName(testTask.id)
    );

    const workspaceBroadcast = vi.mocked(pusherServer.trigger).mock.calls.find(
      (call) => call[0] === getWorkspaceChannelName(testWorkspace.slug)
    );

    expect(taskBroadcast).toBeDefined();
    expect(workspaceBroadcast).toBeDefined();

    // Both broadcasts should have the same core data
    const taskPayload = taskBroadcast![2];
    const workspacePayload = workspaceBroadcast![2];

    expect(taskPayload.taskId).toBe(workspacePayload.taskId);
    expect(taskPayload.workflowStatus).toBe(workspacePayload.workflowStatus);
    expect(taskPayload.timestamp).toBeInstanceOf(Date);
    expect(workspacePayload.timestamp).toBeInstanceOf(Date);

    // Workspace payload should have additional fields
    expect(workspacePayload.taskTitle).toBe(testTask.title);
    expect(workspacePayload.workspaceId).toBe(testWorkspace.id);
  });
});
