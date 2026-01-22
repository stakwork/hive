import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { TaskStatus, WorkflowStatus, FeatureStatus, Priority, ArtifactType } from "@prisma/client";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { POST as POST_MESSAGES_SAVE } from "@/app/api/tasks/[taskId]/messages/save/route";
import { POST as POST_STAKWORK_WEBHOOK } from "@/app/api/stakwork/webhook/route";
import { updateTicket } from "@/services/roadmap/tickets";
import {
  createAuthenticatedSession,
  createAuthenticatedPatchRequest,
  createPostRequest,
  expectSuccess,
  generateUniqueId,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((id) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

describe("Feature Status Sync Integration Tests", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /**
   * Helper function to create a complete feature with tasks setup
   */
  async function createFeatureWithTasks() {
    const user = await db.user.create({
      data: {
        email: `user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `workspace-${generateUniqueId()}`,
        ownerId: user.id,
      },
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        brief: "Test Brief",
        workspaceId: workspace.id,
        status: FeatureStatus.BACKLOG,
        priority: Priority.MEDIUM,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const phase = await db.phase.create({
      data: {
        name: "Phase 1",
        featureId: feature.id,
        order: 0,
      },
    });

    // Create 3 tasks: 1 TODO, 1 IN_PROGRESS, 1 DONE
    const task1 = await db.task.create({
      data: {
        title: "Task 1 - TODO",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const task2 = await db.task.create({
      data: {
        title: "Task 2 - IN_PROGRESS",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const task3 = await db.task.create({
      data: {
        title: "Task 3 - DONE",
        workspaceId: workspace.id,
        featureId: feature.id,
        phaseId: phase.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
        priority: Priority.MEDIUM,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    return { user, workspace, feature, phase, task1, task2, task3 };
  }

  describe("PATCH /api/tasks/[taskId] - Task Status Update", () => {
    test("should sync feature status to IN_PROGRESS when task status changes to IN_PROGRESS", async () => {
      const { user, feature, task1 } = await createFeatureWithTasks();

      // Update task1 from TODO to IN_PROGRESS
      const request = createAuthenticatedPatchRequest(
        `/api/tasks/${task1.id}`,
        { status: TaskStatus.IN_PROGRESS },
        { id: user.id, email: user.email!, name: user.name || "Test User" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task1.id }),
      });

      expectSuccess(response);

      // Verify feature status was synced to IN_PROGRESS
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.IN_PROGRESS);
    });

    test("should sync feature status to COMPLETED when all tasks are DONE", async () => {
      const { user, feature, task1, task2 } = await createFeatureWithTasks();

      // Update task1 to DONE
      await db.task.update({
        where: { id: task1.id },
        data: { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      });

      // Update task2 from IN_PROGRESS to DONE
      const request = createAuthenticatedPatchRequest(
        `/api/tasks/${task2.id}`,
        { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
        { id: user.id, email: user.email!, name: user.name || "Test User" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task2.id }),
      });

      expectSuccess(response);

      // Verify feature status was synced to COMPLETED
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.COMPLETED);
    });

    test("should not fail when task has no featureId", async () => {
      const user = await db.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      const task = await db.task.create({
        data: {
          title: "Standalone Task",
          workspaceId: workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tasks/${task.id}`,
        { status: TaskStatus.IN_PROGRESS },
        { id: user.id, email: user.email!, name: user.name || "Test User" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed without attempting feature sync
      expectSuccess(response);
    });
  });

  describe("POST /api/tasks/[taskId]/messages/save - PR Artifact Auto-Complete", () => {
    test("should sync feature status when PR artifact completes task", async () => {
      const { user, workspace, feature, task1, task2 } = await createFeatureWithTasks();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Update task1 to DONE first
      await db.task.update({
        where: { id: task1.id },
        data: { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      });

      // Save message with PR artifact for task2
      const request = createPostRequest(`/api/tasks/${task2.id}/messages/save`, {
        message: "Created pull request",
        role: "ASSISTANT",
        artifacts: [
          {
            type: ArtifactType.PULL_REQUEST,
            content: {
              url: "https://github.com/test/repo/pull/123",
              number: 123,
            },
          },
        ],
      });

      const response = await POST_MESSAGES_SAVE(request, {
        params: Promise.resolve({ taskId: task2.id }),
      });

      expectSuccess(response, 201);

      // Verify task2 was auto-completed
      const updatedTask = await db.task.findUnique({
        where: { id: task2.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.DONE);
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      // Verify feature status was synced to COMPLETED
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.COMPLETED);
    });

    test("should not sync when task has no featureId", async () => {
      const user = await db.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      const task = await db.task.create({
        data: {
          title: "Standalone Task",
          workspaceId: workspace.id,
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(`/api/tasks/${task.id}/messages/save`, {
        message: "Created pull request",
        role: "ASSISTANT",
        artifacts: [
          {
            type: ArtifactType.PULL_REQUEST,
            content: {
              url: "https://github.com/test/repo/pull/123",
              number: 123,
            },
          },
        ],
      });

      const response = await POST_MESSAGES_SAVE(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed without attempting feature sync
      expectSuccess(response, 201);
    });
  });

  describe("POST /api/stakwork/webhook - Workflow Status Update", () => {
    test("should sync feature status when workflow completes", async () => {
      const { user, workspace, feature, task1, task2 } = await createFeatureWithTasks();

      // Update task1 to DONE first
      await db.task.update({
        where: { id: task1.id },
        data: { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      });

      // Simulate stakwork webhook for task2 completion
      const request = createPostRequest(
        `/api/stakwork/webhook?task_id=${task2.id}`,
        {
          project_status: "completed",
        }
      );

      const response = await POST_STAKWORK_WEBHOOK(request);

      expectSuccess(response);

      // Verify task2 workflow status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: task2.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      // Verify feature status was synced
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      // Feature should be IN_PROGRESS since task2 is still IN_PROGRESS (status != DONE)
      expect(updatedFeature?.status).toBe(FeatureStatus.IN_PROGRESS);
    });

    test("should sync feature status to CANCELLED when workflow fails", async () => {
      const { user, workspace, feature, task1 } = await createFeatureWithTasks();

      // Simulate stakwork webhook for task1 failure
      const request = createPostRequest(
        `/api/stakwork/webhook?task_id=${task1.id}`,
        {
          project_status: "failed",
        }
      );

      const response = await POST_STAKWORK_WEBHOOK(request);

      expectSuccess(response);

      // Verify task1 workflow status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: task1.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);

      // Verify feature status was synced to CANCELLED (error state)
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.CANCELLED);
    });

    test("should not fail when task has no featureId", async () => {
      const user = await db.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      const task = await db.task.create({
        data: {
          title: "Standalone Task",
          workspaceId: workspace.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createPostRequest(
        `/api/stakwork/webhook?task_id=${task.id}`,
        {
          project_status: "completed",
        }
      );

      const response = await POST_STAKWORK_WEBHOOK(request);

      // Should succeed without attempting feature sync
      expectSuccess(response);
    });
  });

  describe("updateTicket service - Roadmap Task Update", () => {
    test("should sync feature status when task status is updated", async () => {
      const { user, workspace, feature, task1 } = await createFeatureWithTasks();

      // Update task1 from TODO to IN_PROGRESS
      const updatedTask = await updateTicket(task1.id, user.id, {
        status: TaskStatus.IN_PROGRESS,
      });

      expect(updatedTask.status).toBe(TaskStatus.IN_PROGRESS);

      // Verify feature status was synced to IN_PROGRESS
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.IN_PROGRESS);
    });

    test("should sync feature status when all tasks are completed", async () => {
      const { user, feature, task1, task2 } = await createFeatureWithTasks();

      // Update task1 to DONE
      await db.task.update({
        where: { id: task1.id },
        data: { status: TaskStatus.DONE, workflowStatus: WorkflowStatus.COMPLETED },
      });

      // Update task2 from IN_PROGRESS to DONE with COMPLETED workflow
      const updatedTask = await updateTicket(task2.id, user.id, {
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      expect(updatedTask.status).toBe(TaskStatus.DONE);

      // Verify feature status was synced to COMPLETED
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.COMPLETED);
    });

    test("should not sync when updating non-status fields", async () => {
      const { user, workspace, feature, task1 } = await createFeatureWithTasks();

      const initialFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      // Update task title only (no status change)
      await updateTicket(task1.id, user.id, {
        title: "Updated Task Title",
      });

      // Verify feature status was NOT changed
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(initialFeature?.status);
    });
  });

  describe("Error Handling", () => {
    test("should not fail main operation if feature sync fails", async () => {
      const { user, feature, task1 } = await createFeatureWithTasks();

      // Delete the feature to cause sync to fail
      await db.feature.delete({
        where: { id: feature.id },
      });

      // Update task should still succeed even if feature sync fails
      const request = createAuthenticatedPatchRequest(
        `/api/tasks/${task1.id}`,
        { status: TaskStatus.IN_PROGRESS },
        { id: user.id, email: user.email!, name: user.name || "Test User" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task1.id }),
      });

      // Should succeed despite feature sync failure
      expectSuccess(response);

      // Verify task was updated
      const updatedTask = await db.task.findUnique({
        where: { id: task1.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  describe("Edge Cases", () => {
    test("should handle feature with no tasks", async () => {
      const user = await db.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Empty Feature",
          brief: "Feature with no tasks",
          workspaceId: workspace.id,
          status: FeatureStatus.BACKLOG,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Feature status should remain unchanged when no tasks exist
      const unchangedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(unchangedFeature?.status).toBe(FeatureStatus.BACKLOG);
    });

    test("should handle mixed task statuses correctly", async () => {
      const { user, feature, task1, task2 } = await createFeatureWithTasks();

      // Set one task to BLOCKED
      await db.task.update({
        where: { id: task1.id },
        data: { status: TaskStatus.BLOCKED },
      });

      // Update task2 to trigger sync
      const request = createAuthenticatedPatchRequest(
        `/api/tasks/${task2.id}`,
        { status: TaskStatus.IN_PROGRESS },
        { id: user.id, email: user.email!, name: user.name || "Test User" }
      );

      await PATCH(request, {
        params: Promise.resolve({ taskId: task2.id }),
      });

      // Feature should be IN_PROGRESS (blocked tasks keep it in progress)
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.status).toBe(FeatureStatus.IN_PROGRESS);
    });
  });
});
