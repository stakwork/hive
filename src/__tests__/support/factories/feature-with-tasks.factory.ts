import { db } from "@/lib/db";
import { Feature, Phase, Task, Priority, TaskStatus } from "@prisma/client";

/**
 * Options for creating a feature with auto-merge tasks
 */
export interface CreateTestFeatureWithAutoMergeTasksOptions {
  workspaceId: string;
  userId: string;
  taskCount: number;
  allAutoMerge?: boolean; // If true, all tasks have autoMerge: true. If false, alternates true/false
  sequential?: boolean; // If true, creates dependency chain (task N depends on task N-1)
  featureTitle?: string;
  phaseTitle?: string;
  priorities?: readonly Priority[]; // Custom priorities for each task (must match taskCount)
}

/**
 * Creates a test feature with multiple tasks configured for auto-merge testing
 * Supports sequential dependency chains and mixed auto-merge settings
 */
export async function createTestFeatureWithAutoMergeTasks(
  options: CreateTestFeatureWithAutoMergeTasksOptions,
): Promise<{ feature: Feature; phase: Phase; tasks: Task[] }> {
  const {
    workspaceId,
    userId,
    taskCount,
    allAutoMerge = true,
    sequential = false,
    featureTitle,
    phaseTitle,
    priorities,
  } = options;

  if (priorities && priorities.length !== taskCount) {
    throw new Error(
      `priorities length (${priorities.length}) must match taskCount (${taskCount})`,
    );
  }

  // Create feature
  const feature = await db.feature.create({
    data: {
      title: featureTitle ?? "Test Feature with Auto-Merge Tasks",
      brief: "Feature for testing auto-merge functionality",
      workspaceId,
      createdById: userId,
      updatedById: userId,
    },
  });

  // Create phase
  const phase = await db.phase.create({
    data: {
      name: phaseTitle ?? "Phase 1",
      featureId: feature.id,
      order: 0,
    },
  });

  // Create tasks
  const tasks: Task[] = [];

  for (let i = 0; i < taskCount; i++) {
    const autoMerge = allAutoMerge ? true : i % 2 === 0; // Alternate if not allAutoMerge
    const dependsOnTaskIds = sequential && i > 0 ? [tasks[i - 1].id] : [];
    const priority = priorities ? priorities[i] : Priority.MEDIUM;

    const task = await db.task.create({
      data: {
        title: `Task ${i + 1} - ${autoMerge ? "Auto-merge" : "Manual merge"}`,
        description: `Test task ${i + 1} for auto-merge functionality`,
        workspaceId,
        featureId: feature.id,
        phaseId: phase.id,
        createdById: userId,
        updatedById: userId,
        status: TaskStatus.TODO,
        priority,
        sourceType: "SYSTEM",
        autoMerge,
        dependsOnTaskIds,
        order: i,
      },
    });

    tasks.push(task);
  }

  return { feature, phase, tasks };
}
