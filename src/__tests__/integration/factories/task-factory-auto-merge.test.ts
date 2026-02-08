import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createTestTask,
  createTestFeatureWithAutoMergeTasks,
} from "@/__tests__/support/factories/task.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

describe("Task Factory - Auto-Merge Support", () => {
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await resetDatabase();

    // Create test user and workspace
    const user = await db.user.create({
      data: {
        email: "test-automerge@example.com",
        name: "Test User",
      },
    });
    userId = user.id;

    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-automerge-ws",
        createdById: userId,
        updatedById: userId,
      },
    });
    workspaceId = workspace.id;

    // Add user as workspace member
    await db.workspaceMembership.create({
      data: {
        userId,
        workspaceId,
        role: "OWNER",
      },
    });
  });

  afterAll(async () => {
    await resetDatabase();
  });

  describe("createTestTask with autoMerge", () => {
    it("should create task with autoMerge: true", async () => {
      const task = await createTestTask({
        title: "Test Task with Auto-Merge",
        workspaceId,
        createdById: userId,
        autoMerge: true,
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(true);
      expect(task.title).toBe("Test Task with Auto-Merge");
    });

    it("should create task with autoMerge: false", async () => {
      const task = await createTestTask({
        title: "Test Task without Auto-Merge",
        workspaceId,
        createdById: userId,
        autoMerge: false,
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(false);
    });

    it("should default to autoMerge: true when not specified", async () => {
      const task = await createTestTask({
        title: "Test Task Default Auto-Merge",
        workspaceId,
        createdById: userId,
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(true);
    });
  });

  describe("createTestFeatureWithAutoMergeTasks", () => {
    it("should create feature with all tasks having autoMerge: true", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId,
        userId,
        taskCount: 3,
        allAutoMerge: true,
        sequential: false,
      });

      expect(result.feature).toBeDefined();
      expect(result.phase).toBeDefined();
      expect(result.tasks).toHaveLength(3);
      result.tasks.forEach((task) => {
        expect(task.autoMerge).toBe(true);
      });
    });

    it("should create feature with sequential task dependencies", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId,
        userId,
        featureTitle: "Sequential Feature",
        taskCount: 3,
        allAutoMerge: true,
        sequential: true,
      });

      expect(result.tasks).toHaveLength(3);
      
      // First task should have no dependencies
      expect(result.tasks[0].dependsOnTaskIds).toEqual([]);
      
      // Second task should depend on first
      expect(result.tasks[1].dependsOnTaskIds).toContain(result.tasks[0].id);
      
      // Third task should depend on second
      expect(result.tasks[2].dependsOnTaskIds).toContain(result.tasks[1].id);
    });

    it("should create feature with mixed autoMerge pattern", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId,
        userId,
        taskCount: 3,
        sequential: true,
        autoMergePattern: [true, false, true],
      });

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].autoMerge).toBe(true);
      expect(result.tasks[1].autoMerge).toBe(false);
      expect(result.tasks[2].autoMerge).toBe(true);
    });

    it("should assign tasks to correct feature and phase", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId,
        userId,
        featureTitle: "Payment Integration",
        taskCount: 2,
        allAutoMerge: true,
      });

      expect(result.feature.title).toBe("Payment Integration");
      result.tasks.forEach((task) => {
        expect(task.featureId).toBe(result.feature.id);
        expect(task.phaseId).toBe(result.phase.id);
        expect(task.workspaceId).toBe(workspaceId);
      });
    });
  });
});
