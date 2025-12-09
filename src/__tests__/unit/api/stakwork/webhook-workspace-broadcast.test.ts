import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stakwork/webhook/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    stakworkRun: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "WORKFLOW_STATUS_UPDATE",
    STAKWORK_RUN_UPDATE: "STAKWORK_RUN_UPDATE",
  },
}));

vi.mock("@/utils/conversions", () => ({
  mapStakworkStatus: vi.fn((status: string) => {
    if (status === "in_progress") return WorkflowStatus.IN_PROGRESS;
    if (status === "completed") return WorkflowStatus.COMPLETED;
    if (status === "failed") return WorkflowStatus.FAILED;
    return null;
  }),
}));

import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

describe("Stakwork Webhook - Workspace Broadcast", () => {
  const mockTaskId = "test-task-123";
  const mockWorkspaceSlug = "test-workspace";
  const mockWorkspaceId = "workspace-id-123";
  const mockTaskTitle = "Test Task Title";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockRequest = (body: object, queryParams?: Record<string, string>) => {
    const url = new URL("http://localhost:3000/api/stakwork/webhook");
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    return {
      url: url.toString(),
      json: vi.fn().mockResolvedValue(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  };

  describe("Dual-channel broadcasting", () => {
    it("should broadcast to both task and workspace channels when workspace exists", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
        workflowCompletedAt: null,
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest(
        {
          project_status: "in_progress",
          task_id: mockTaskId,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify task channel broadcast
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        getTaskChannelName(mockTaskId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.objectContaining({
          taskId: mockTaskId,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          timestamp: expect.any(Date),
        })
      );

      // Verify workspace channel broadcast
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        getWorkspaceChannelName(mockWorkspaceSlug),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.objectContaining({
          taskId: mockTaskId,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          taskTitle: mockTaskTitle,
          workspaceId: mockWorkspaceId,
          timestamp: expect.any(Date),
        })
      );

      // Verify both channels were called
      expect(pusherServer.trigger).toHaveBeenCalledTimes(2);
    });

    it("should include workspace relation in db.task.update query", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.COMPLETED,
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest({
        project_status: "completed",
        task_id: mockTaskId,
      });

      await POST(request);

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: expect.any(Object),
        include: {
          workspace: {
            select: { slug: true, id: true },
          },
        },
      });
    });
  });

  describe("Workspace payload structure", () => {
    it("should include all required fields in workspace broadcast payload", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.FAILED,
        workflowCompletedAt: new Date(),
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest({
        project_status: "failed",
        task_id: mockTaskId,
      });

      await POST(request);

      const workspaceBroadcastCall = vi.mocked(pusherServer.trigger).mock.calls.find(
        (call) => call[0] === getWorkspaceChannelName(mockWorkspaceSlug)
      );

      expect(workspaceBroadcastCall).toBeDefined();
      const payload = workspaceBroadcastCall![2];

      expect(payload).toMatchObject({
        taskId: mockTaskId,
        workflowStatus: WorkflowStatus.FAILED,
        taskTitle: mockTaskTitle,
        workspaceId: mockWorkspaceId,
      });
      expect(payload.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("Graceful handling of missing workspace", () => {
    it("should only broadcast to task channel when workspace is null", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date(),
        workspace: null, // No workspace
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest({
        project_status: "in_progress",
        task_id: mockTaskId,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify only task channel was called
      expect(pusherServer.trigger).toHaveBeenCalledTimes(1);
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        getTaskChannelName(mockTaskId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.any(Object)
      );

      // Verify workspace channel was NOT called
      expect(pusherServer.trigger).not.toHaveBeenCalledWith(
        expect.stringContaining("workspace-"),
        expect.anything(),
        expect.anything()
      );
    });

    it("should only broadcast to task channel when workspace slug is missing", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.COMPLETED,
        workspace: {
          slug: null, // slug is null
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest({
        project_status: "completed",
        task_id: mockTaskId,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(pusherServer.trigger).toHaveBeenCalledTimes(1);
    });

    it("should not throw error when workspace broadcast fails", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      // Mock workspace broadcast failure
      vi.mocked(pusherServer.trigger).mockImplementation((channel: string) => {
        if (channel.includes("workspace-")) {
          throw new Error("Pusher workspace broadcast failed");
        }
        return Promise.resolve();
      });

      const request = createMockRequest({
        project_status: "in_progress",
        task_id: mockTaskId,
      });

      const response = await POST(request);
      const data = await response.json();

      // Should still return success
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Existing task channel functionality", () => {
    it("should maintain task channel broadcast functionality", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const workflowStartedAt = new Date();
      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt,
        workflowCompletedAt: null,
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      const request = createMockRequest({
        project_status: "in_progress",
        task_id: mockTaskId,
      });

      await POST(request);

      // Verify task channel payload structure remains unchanged
      const taskBroadcastCall = vi.mocked(pusherServer.trigger).mock.calls.find(
        (call) => call[0] === getTaskChannelName(mockTaskId)
      );

      expect(taskBroadcastCall).toBeDefined();
      const payload = taskBroadcastCall![2];

      expect(payload).toMatchObject({
        taskId: mockTaskId,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt,
        workflowCompletedAt: null,
        timestamp: expect.any(Date),
      });

      // Task payload should NOT include taskTitle or workspaceId
      expect(payload).not.toHaveProperty("taskTitle");
      expect(payload).not.toHaveProperty("workspaceId");
    });

    it("should not affect task broadcast when workspace broadcast fails", async () => {
      const mockTask = {
        id: mockTaskId,
        title: mockTaskTitle,
        workflowStatus: WorkflowStatus.PENDING,
        deleted: false,
      };

      const mockUpdatedTask = {
        ...mockTask,
        workflowStatus: WorkflowStatus.COMPLETED,
        workflowCompletedAt: new Date(),
        workspace: {
          slug: mockWorkspaceSlug,
          id: mockWorkspaceId,
        },
      };

      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask as any);

      let taskChannelBroadcastSucceeded = false;

      vi.mocked(pusherServer.trigger).mockImplementation((channel: string) => {
        if (channel === getTaskChannelName(mockTaskId)) {
          taskChannelBroadcastSucceeded = true;
          return Promise.resolve();
        }
        throw new Error("Workspace broadcast error");
      });

      const request = createMockRequest({
        project_status: "completed",
        task_id: mockTaskId,
      });

      await POST(request);

      expect(taskChannelBroadcastSucceeded).toBe(true);
    });
  });
});
