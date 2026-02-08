import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { seedAutoMergeTestScenarios } from "@/../scripts/helpers/seed-database";
import { createTestUser } from "../../support/factories/user.factory";
import { createTestWorkspace } from "../../support/factories/workspace.factory";

describe("Seed Database - Auto-Merge Integration", () => {
  beforeEach(async () => {
    // Create prerequisite data (users and workspaces) before seeding auto-merge scenarios
    const user1 = await createTestUser({ name: "Test User 1" });
    const user2 = await createTestUser({ name: "Test User 2" });
    await createTestWorkspace({ name: "Test Workspace", ownerId: user1.id });
    
    // Seed the auto-merge test scenarios
    await seedAutoMergeTestScenarios();
  });

  it("should have Payment Integration feature with 3 sequential autoMerge tasks", async () => {
    const feature = await db.feature.findFirst({
      where: { title: "Payment Integration" },
      include: {
        phases: {
          include: {
            tasks: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    expect(feature).toBeDefined();
    expect(feature?.phases[0]?.tasks).toHaveLength(3);

    const tasks = feature?.phases[0]?.tasks || [];
    
    // All tasks should have autoMerge: true
    expect(tasks[0].autoMerge).toBe(true);
    expect(tasks[1].autoMerge).toBe(true);
    expect(tasks[2].autoMerge).toBe(true);

    // Check sequential dependencies
    expect(tasks[0].dependsOnTaskIds).toHaveLength(0);
    expect(tasks[1].dependsOnTaskIds).toContain(tasks[0].id);
    expect(tasks[2].dependsOnTaskIds).toContain(tasks[1].id);

    // Check task assignment to coordinator
    expect(tasks[0].systemAssigneeType).toBe("TASK_COORDINATOR");
    expect(tasks[1].systemAssigneeType).toBe("TASK_COORDINATOR");
    expect(tasks[2].systemAssigneeType).toBe("TASK_COORDINATOR");
  });

  it("should have User Profile Enhancement feature with mixed autoMerge settings", async () => {
    const feature = await db.feature.findFirst({
      where: { title: "User Profile Enhancement" },
      include: {
        phases: {
          include: {
            tasks: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    expect(feature).toBeDefined();
    expect(feature?.phases[0]?.tasks).toHaveLength(3);

    const tasks = feature?.phases[0]?.tasks || [];

    // Check mixed autoMerge settings
    expect(tasks[0].autoMerge).toBe(true);  // Update profile schema
    expect(tasks[1].autoMerge).toBe(false); // Add profile edit UI (manual merge)
    expect(tasks[2].autoMerge).toBe(true);  // Add avatar upload

    // Check dependencies
    expect(tasks[0].dependsOnTaskIds).toHaveLength(0);
    expect(tasks[1].dependsOnTaskIds).toContain(tasks[0].id);
    expect(tasks[2].dependsOnTaskIds).toContain(tasks[1].id);
  });

  it("should have edge case tasks with PR artifacts", async () => {
    const edgeCaseTasks = await db.task.findMany({
      where: {
        title: {
          contains: "open PR",
        },
      },
      include: {
        chatMessages: {
          include: {
            artifacts: true,
          },
        },
      },
    });

    // Should have at least one edge case task with PR artifact
    expect(edgeCaseTasks.length).toBeGreaterThan(0);

    const taskWithPR = edgeCaseTasks[0];
    expect(taskWithPR.autoMerge).toBe(true);
    expect(taskWithPR.status).toBe("IN_PROGRESS");

    // Check for PR artifact
    const prArtifact = taskWithPR.chatMessages
      .flatMap((msg) => msg.artifacts)
      .find((artifact) => artifact.type === "PULL_REQUEST");

    expect(prArtifact).toBeDefined();
  });

  it("should have tasks with correct priorities and statuses", async () => {
    const paymentTasks = await db.task.findMany({
      where: {
        feature: {
          title: "Payment Integration",
        },
      },
      orderBy: { order: "asc" },
    });

    expect(paymentTasks).toHaveLength(3);

    // First task should be TODO, others TODO with dependencies
    expect(paymentTasks[0].status).toBe("TODO");
    expect(paymentTasks[1].status).toBe("TODO");
    expect(paymentTasks[2].status).toBe("TODO");

    // All should have appropriate priorities
    expect(paymentTasks[0].priority).toBe("HIGH");
    expect(paymentTasks[1].priority).toBe("HIGH");
    expect(paymentTasks[2].priority).toBe("MEDIUM");
  });

  it("should have at least 10 auto-merge test tasks total", async () => {
    const autoMergeTasks = await db.task.findMany({
      where: {
        OR: [
          {
            feature: {
              title: {
                in: [
                  "Payment Integration",
                  "User Profile Enhancement",
                  "Edge Case Testing Feature",
                ],
              },
            },
          },
        ],
      },
    });

    // Should have 6 feature tasks + 4 edge case tasks = 10 total
    expect(autoMergeTasks.length).toBeGreaterThanOrEqual(10);
  });
});
