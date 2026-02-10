import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestTask } from "@/__tests__/support/factories/task.factory";
import { createTestFeatureWithAutoMergeTasks } from "@/__tests__/support/factories/feature-with-tasks.factory";

describe("Seed Database - Auto-Merge Test Data", () => {
  let testUser: { id: string; email: string };
  let testWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    // Create test user directly
    testUser = await db.user.create({
      data: {
        email: `test-seed-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    // Create test workspace directly
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-seed-${Date.now()}`,
        ownerId: testUser.id,
      },
    });

    // Add user as workspace owner
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  }, 10000); // 10 second timeout for setup

  afterEach(async () => {
    // Cleanup in reverse order of dependencies
    await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.phase.deleteMany({ where: { feature: { workspaceId: testWorkspace.id } } });
    await db.feature.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
  }, 10000); // 10 second timeout for cleanup

  describe("createTestTask", () => {
    it("should create task with autoMerge: true by default", async () => {
      const task = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: "Test task with default autoMerge",
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(true);
    });

    it("should create task with autoMerge: true when explicitly set", async () => {
      const task = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: "Test task with autoMerge enabled",
        autoMerge: true,
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(true);
    });

    it("should create task with autoMerge: false when explicitly set", async () => {
      const task = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: "Test task with autoMerge disabled",
        autoMerge: false,
      });

      expect(task).toBeDefined();
      expect(task.autoMerge).toBe(false);
    });

    it("should create task with dependencies and autoMerge", async () => {
      const task1 = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: "First task",
        autoMerge: true,
      });

      const task2 = await createTestTask({
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        title: "Second task",
        autoMerge: true,
        dependsOnTaskIds: [task1.id],
      });

      expect(task2.dependsOnTaskIds).toContain(task1.id);
      expect(task2.autoMerge).toBe(true);
    });
  });

  describe("createTestFeatureWithAutoMergeTasks", () => {
    it("should create feature with all tasks having autoMerge: true", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
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

    it("should create feature with mixed autoMerge settings", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        taskCount: 3,
        allAutoMerge: false,
        sequential: false,
      });

      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].autoMerge).toBe(true); // Even index
      expect(result.tasks[1].autoMerge).toBe(false); // Odd index
      expect(result.tasks[2].autoMerge).toBe(true); // Even index
    });

    it("should create sequential dependency chain", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        taskCount: 3,
        allAutoMerge: true,
        sequential: true,
      });

      const [task1, task2, task3] = result.tasks;

      expect(task1.dependsOnTaskIds).toHaveLength(0);
      expect(task2.dependsOnTaskIds).toContain(task1.id);
      expect(task3.dependsOnTaskIds).toContain(task2.id);
    });

    it("should create tasks with custom priorities", async () => {
      const priorities = ["HIGH", "MEDIUM", "LOW"] as const;
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        taskCount: 3,
        allAutoMerge: true,
        sequential: false,
        priorities,
      });

      expect(result.tasks[0].priority).toBe("HIGH");
      expect(result.tasks[1].priority).toBe("MEDIUM");
      expect(result.tasks[2].priority).toBe("LOW");
    });

    it("should create tasks with correct order", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        taskCount: 3,
        allAutoMerge: true,
        sequential: true,
      });

      expect(result.tasks[0].order).toBe(0);
      expect(result.tasks[1].order).toBe(1);
      expect(result.tasks[2].order).toBe(2);
    });

    it("should associate all tasks with the feature and phase", async () => {
      const result = await createTestFeatureWithAutoMergeTasks({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        taskCount: 3,
        allAutoMerge: true,
        sequential: false,
      });

      result.tasks.forEach((task) => {
        expect(task.featureId).toBe(result.feature.id);
        expect(task.phaseId).toBe(result.phase.id);
      });
    });
  });
});
