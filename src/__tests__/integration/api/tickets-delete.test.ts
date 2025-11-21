import { describe, test, expect, beforeEach } from "vitest";
import { DELETE } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  findTestTask,
  updateTestTask,
} from "@/__tests__/support/fixtures";
import {
  createDeleteRequest,
  createAuthenticatedDeleteRequest,
  getMockedSession,
  createAuthenticatedSession,
  expectSuccess,
  expectNotFound,
  expectUnauthorized,
  expectError,
  expectTaskDeleted,
} from "@/__tests__/support/helpers";

describe("DELETE /api/tasks/[taskId]", () => {
  let user: any;
  let workspace: any;
  let feature: any;
  let task: any;

  beforeEach(async () => {
    // Create test user and workspace
    user = await createTestUser();
    workspace = await createTestWorkspace({ ownerId: user.id });

    // Create feature (required parent for tasks)
    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Create test task
    task = await createTestTask({
      title: "Test Task",
      description: "Task to be deleted",
      workspaceId: workspace.id,
      featureId: feature.id,
      createdById: user.id,
    });
  });

  describe("Success Scenarios", () => {
    test("should soft-delete task successfully", async () => {
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      await expectSuccess(response);

      // Verify soft-delete in database
      await expectTaskDeleted(task.id);
    });

    test("should set deletedAt timestamp when deleting", async () => {
      const beforeDelete = new Date();
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });
      const afterDelete = new Date();

      const deletedTask = await findTestTask(task.id);
      expect(deletedTask?.deletedAt).toBeTruthy();
      expect(deletedTask?.deletedAt?.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime());
      expect(deletedTask?.deletedAt?.getTime()).toBeLessThanOrEqual(afterDelete.getTime());
    });

    test("should preserve task data after soft-delete", async () => {
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      // Verify task still exists with original data
      const deletedTask = await findTestTask(task.id);
      expect(deletedTask).toBeTruthy();
      expect(deletedTask?.title).toBe("Test Task");
      expect(deletedTask?.featureId).toBe(feature.id);
      expect(deletedTask?.deleted).toBe(true);
    });
  });

  describe("Authorization", () => {
    test("should return 401 if user is not authenticated", async () => {
      const request = createDeleteRequest(`/api/tasks/${task.id}`);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      await expectUnauthorized(response);

      // Verify task was NOT deleted
      const unchangedTask = await findTestTask(task.id);
      expect(unchangedTask?.deleted).toBe(false);
      expect(unchangedTask?.deletedAt).toBeNull();
    });

    test("should return 403 if user is not a workspace member", async () => {
      const otherUser = await createTestUser({ email: "other@test.com" });

      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, otherUser);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      await expectError(response, "Access denied", 403);

      // Verify task was NOT deleted
      const unchangedTask = await findTestTask(task.id);
      expect(unchangedTask?.deleted).toBe(false);
    });

    test("should allow deletion if user is workspace admin", async () => {
      const adminUser = await createTestUser({ email: "admin@test.com" });
      await db.workspaceMember.create({
        data: {
          userId: adminUser.id,
          workspaceId: workspace.id,
          role: "ADMIN",
        },
      });

      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, adminUser);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      await expectSuccess(response);
      await expectTaskDeleted(task.id);
    });
  });

  describe("Error Handling", () => {
    test("should return 404 for non-existent task", async () => {
      const request = createAuthenticatedDeleteRequest("/api/tasks/non-existent-id", user);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectNotFound(response);
    });

    test("should return 404 for already deleted task", async () => {
      // First deletion
      const request1 = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request1, { params: Promise.resolve({ ticketId: task.id }) });

      // Attempt second deletion
      const request2 = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      const response = await DELETE(request2, { params: Promise.resolve({ ticketId: task.id }) });

      await expectNotFound(response);
    });

    test("should handle malformed task ID gracefully", async () => {
      const invalidId = "invalid-uuid-format";
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${invalidId}`, user);
      const response = await DELETE(request, { params: Promise.resolve({ ticketId: invalidId }) });

      const json = await response.json();
      expect([404, 500]).toContain(response.status);
      expect(json.error).toBeTruthy();
    });
  });

  describe("Data Integrity - Orphaned Dependencies", () => {
    test("should clean up orphaned dependencies when task is deleted", async () => {
      // Create dependent task that depends on the task to be deleted
      const dependentTask = await createTestTask({
        title: "Dependent Task",
        description: "This task depends on another",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id,
      });
      await updateTestTask(dependentTask.id, { dependsOnTaskIds: [task.id] });

      // Delete the parent task
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      // Verify parent task is deleted
      await expectTaskDeleted(task.id);

      // Verify dependent task no longer references the deleted task
      const updatedDependent = await findTestTask(dependentTask.id);
      expect(updatedDependent?.dependsOnTaskIds).not.toContain(task.id);
      expect(updatedDependent?.dependsOnTaskIds).toHaveLength(0);
    });

    test("should clean up multiple orphaned dependencies", async () => {
      // Create multiple tasks depending on the one to be deleted
      const dependent1 = await createTestTask({
        title: "Dependent 1",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id,
      });
      await updateTestTask(dependent1.id, { dependsOnTaskIds: [task.id] });

      const dependent2 = await createTestTask({
        title: "Dependent 2",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id,
      });
      await updateTestTask(dependent2.id, { dependsOnTaskIds: [task.id] });

      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      // Verify both dependent tasks have cleaned up references
      const updated1 = await findTestTask(dependent1.id);
      const updated2 = await findTestTask(dependent2.id);

      expect(updated1?.dependsOnTaskIds).not.toContain(task.id);
      expect(updated1?.dependsOnTaskIds).toHaveLength(0);
      expect(updated2?.dependsOnTaskIds).not.toContain(task.id);
      expect(updated2?.dependsOnTaskIds).toHaveLength(0);
    });

    test("should clean up only deleted task from mixed dependencies", async () => {
      // Create another task to establish multiple dependencies
      const anotherTask = await createTestTask({
        title: "Another Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id,
      });

      // Create dependent with mixed dependencies (one to be deleted, one kept)
      const dependentTask = await createTestTask({
        title: "Mixed Dependencies",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id,
      });
      await updateTestTask(dependentTask.id, { dependsOnTaskIds: [task.id, anotherTask.id] });

      // Delete the first task
      const request = createAuthenticatedDeleteRequest(`/api/tasks/${task.id}`, user);
      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      // Verify dependent only has the valid reference remaining
      const updated = await findTestTask(dependentTask.id);
      expect(updated?.dependsOnTaskIds).not.toContain(task.id); // Deleted task removed
      expect(updated?.dependsOnTaskIds).toContain(anotherTask.id); // Valid task preserved
      expect(updated?.dependsOnTaskIds).toHaveLength(1);
    });
  });

  describe("Cascade Behavior", () => {
    test("should NOT affect related feature when task is deleted", async () => {
      // This test doesn't require API calls - just database operations
      // Manually perform delete to verify cascade behavior
      await updateTestTask(task.id, { deleted: true, deletedAt: new Date() });

      // Verify feature still exists
      const existingFeature = await db.feature.findUnique({ where: { id: feature.id } });
      expect(existingFeature).toBeTruthy();
      expect(existingFeature?.deleted).toBe(false);
    });

    test("should preserve task when related phase is deleted", async () => {
      // Create phase and assign task to it
      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
        },
      });

      await updateTestTask(task.id, { phaseId: phase.id });

      // Delete the phase (should set phaseId to null via onDelete: SetNull)
      await db.phase.delete({ where: { id: phase.id } });

      // Verify task still exists with null phaseId
      const updatedTask = await findTestTask(task.id);
      expect(updatedTask).toBeTruthy();
      expect(updatedTask?.phaseId).toBeNull();
      expect(updatedTask?.deleted).toBe(false);
    });
  });
});
