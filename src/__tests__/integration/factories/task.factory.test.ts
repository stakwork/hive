import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestTask,
  createTestFeatureWithAutoMergeTasks,
} from "@/__tests__/support/factories/task.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { db } from "@/lib/db";

describe("Task Factory - Auto-Merge Support", () => {
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();

    // Create test user and workspace
    const user = await db.user.create({
      data: {
        name: "Test User",
        email: `test-${Date.now()}@example.com`,
      },
    });
    userId = user.id;

    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-ws-${Date.now()}`,
        ownerId: userId,
      },
    });
    workspaceId = workspace.id;
  });

  describe("createTestTask", () => {
    it("should create task with autoMerge: true", async () => {
      const task = await createTestTask({
        workspaceId,
        userId,
        autoMerge: true,
      });

      expect(task.autoMerge).toBe(true);
      expect(task.title).toBeDefined();
      expect(task.workspaceId).toBe(workspaceId);
    });

    it("should create task with autoMerge: false", async () => {
      const task = await createTestTask({
        workspaceId,
        userId,
        autoMerge: false,
      });

      expect(task.autoMerge).toBe(false);
    });

    it("should default to autoMerge: true when not specified", async () => {
      const task = await createTestTask({
        workspaceId,
        userId,
      });

      expect(task.autoMerge).toBe(true);
    });
  });

  describe("createTestFeatureWithAutoMergeTasks", () => {
    it("should create feature with all tasks having autoMerge: true", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 3,
          allAutoMerge: true,
          sequential: false,
        }
      );

      expect(feature).toBeDefined();
      expect(tasks).toHaveLength(3);
      expect(tasks.every((t) => t.autoMerge === true)).toBe(true);
      expect(feature.workspaceId).toBe(workspaceId);
    });

    it("should create feature with mixed autoMerge settings", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 3,
          allAutoMerge: false,
          sequential: false,
        }
      );

      expect(feature).toBeDefined();
      expect(tasks).toHaveLength(3);
      
      // With allAutoMerge: false, tasks alternate (even index = true, odd = false)
      expect(tasks[0].autoMerge).toBe(true);
      expect(tasks[1].autoMerge).toBe(false);
      expect(tasks[2].autoMerge).toBe(true);
    });

    it("should create sequential task dependencies when sequential: true", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 3,
          allAutoMerge: true,
          sequential: true,
        }
      );

      expect(tasks).toHaveLength(3);
      
      // First task has no dependencies
      expect(tasks[0].dependsOnTaskIds).toHaveLength(0);
      
      // Second task depends on first
      expect(tasks[1].dependsOnTaskIds).toEqual([tasks[0].id]);
      
      // Third task depends on second
      expect(tasks[2].dependsOnTaskIds).toEqual([tasks[1].id]);
    });

    it("should create independent tasks when sequential: false", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 3,
          allAutoMerge: true,
          sequential: false,
        }
      );

      expect(tasks).toHaveLength(3);
      expect(tasks.every((t) => t.dependsOnTaskIds.length === 0)).toBe(true);
    });

    it("should create feature with custom title and status", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 2,
          featureTitle: "Custom Feature Title",
          featureStatus: "PLANNED",
        }
      );

      expect(feature.title).toBe("Custom Feature Title");
      expect(feature.status).toBe("PLANNED");
      expect(tasks).toHaveLength(2);
    });

    it("should create feature with phase", async () => {
      const { feature } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 2,
        }
      );

      const featureWithPhase = await db.feature.findUnique({
        where: { id: feature.id },
        include: { phases: true },
      });

      expect(featureWithPhase?.phases).toHaveLength(1);
      expect(featureWithPhase?.phases[0].name).toBe("Test Phase");
    });

    it("should assign all tasks to the created phase", async () => {
      const { feature, tasks } = await createTestFeatureWithAutoMergeTasks(
        workspaceId,
        userId,
        {
          taskCount: 3,
        }
      );

      const featureWithPhase = await db.feature.findUnique({
        where: { id: feature.id },
        include: { phases: true },
      });

      const phaseId = featureWithPhase?.phases[0].id;
      expect(tasks.every((t) => t.phaseId === phaseId)).toBe(true);
    });
  });
});
