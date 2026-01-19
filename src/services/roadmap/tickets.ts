import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import type {
  CreateRoadmapTaskRequest,
  UpdateRoadmapTaskRequest,
  RoadmapTaskWithDetails,
  RoadmapTaskDetail,
} from "@/types/roadmap";
import { validateFeatureAccess, validateRoadmapTaskAccess, calculateNextOrder } from "./utils";
import { USER_SELECT } from "@/lib/db/selects";
import { validateEnum } from "@/lib/validators";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";
import { getSystemAssigneeUser } from "@/lib/system-assignees";
import { updateFeatureStatusFromTasks } from "./feature-status-sync";

/**
 * Gets a roadmap task with full context (feature, phase, creator, updater)
 */
export async function getTicket(
  taskId: string,
  userId: string
): Promise<RoadmapTaskDetail> {
  const task = await validateRoadmapTaskAccess(taskId, userId);
  if (!task) {
    throw new Error("Task not found or access denied");
  }

  const taskDetail = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      bountyCode: true,
      dependsOnTaskIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      feature: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      },
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
    },
  });

  if (!taskDetail) {
    throw new Error("Task not found");
  }

  // Convert system assignee type to virtual user object
  if (taskDetail.systemAssigneeType) {
    const systemAssignee = getSystemAssigneeUser(taskDetail.systemAssigneeType);

    if (systemAssignee) {
      return {
        ...taskDetail,
        assignee: systemAssignee,
      };
    }
  }

  return taskDetail;
}

/**
 * Creates a new roadmap task for a feature
 */
export async function createTicket(
  featureId: string,
  userId: string,
  data: CreateRoadmapTaskRequest
): Promise<RoadmapTaskWithDetails> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("Title is required");
  }

  validateEnum(data.status, TaskStatus, "status");
  validateEnum(data.priority, Priority, "priority");

  // Resolve phaseId: use provided value or default to first phase
  let resolvedPhaseId = data.phaseId || null;

  if (data.phaseId) {
    // Validate provided phaseId belongs to this feature
    const phase = await db.phase.findFirst({
      where: {
        id: data.phaseId,
        featureId: featureId,
        deleted: false,
      },
    });

    if (!phase) {
      throw new Error("Phase not found or does not belong to this feature");
    }
  } else {
    // Default to the first phase for this feature
    const defaultPhase = await db.phase.findFirst({
      where: {
        featureId: featureId,
        deleted: false,
      },
      orderBy: {
        order: "asc",
      },
      select: {
        id: true,
      },
    });

    if (defaultPhase) {
      resolvedPhaseId = defaultPhase.id;
    }
  }

  if (data.assigneeId) {
    // Skip validation for system assignees
    if (!data.assigneeId.startsWith("system:")) {
      const assignee = await db.user.findUnique({
        where: { id: data.assigneeId },
      });

      if (!assignee) {
        throw new Error("Assignee not found");
      }
    }
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const nextOrder = await calculateNextOrder(db.task, {
    featureId,
    phaseId: resolvedPhaseId,
  });

  // Determine if assignee is a system assignee
  const isSystemAssignee = data.assigneeId?.startsWith("system:");
  const systemAssigneeType = isSystemAssignee
    ? data.assigneeId === "system:task-coordinator"
      ? "TASK_COORDINATOR"
      : "BOUNTY_HUNTER"
    : null;

  const bountyCode = await ensureUniqueBountyCode();

  const task = await db.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      workspaceId: feature.workspaceId,
      featureId,
      phaseId: resolvedPhaseId,
      status: data.status || TaskStatus.TODO,
      priority: data.priority || Priority.MEDIUM,
      order: nextOrder,
      assigneeId: isSystemAssignee ? null : (data.assigneeId || null),
      systemAssigneeType: systemAssigneeType,
      bountyCode: bountyCode,
      dependsOnTaskIds: data.dependsOnTaskIds || [],
      runBuild: data.runBuild ?? true,
      runTestSuite: data.runTestSuite ?? true,
      createdById: userId,
      updatedById: userId,
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      bountyCode: true,
      dependsOnTaskIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Convert system assignee type to virtual user object
  if (task.systemAssigneeType) {
    const systemAssignee = getSystemAssigneeUser(task.systemAssigneeType);

    if (systemAssignee) {
      return {
        ...task,
        assignee: systemAssignee,
      };
    }
  }

  return task;
}

/**
 * Updates a roadmap task
 */
export async function updateTicket(
  taskId: string,
  userId: string,
  data: UpdateRoadmapTaskRequest
): Promise<RoadmapTaskWithDetails> {
  const task = await validateRoadmapTaskAccess(taskId, userId);
  if (!task) {
    throw new Error("Task not found or access denied");
  }

  const updateData: any = {
    updatedById: userId,
  };

  if (data.title !== undefined) {
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new Error("Title cannot be empty");
    }
    updateData.title = data.title.trim();
  }

  if (data.description !== undefined) {
    updateData.description = data.description?.trim() || null;
  }

  if (data.status !== undefined) {
    validateEnum(data.status, TaskStatus, "status");
    updateData.status = data.status;
  }

  if (data.priority !== undefined) {
    validateEnum(data.priority, Priority, "priority");
    updateData.priority = data.priority;
  }

  if (data.runBuild !== undefined) {
    updateData.runBuild = data.runBuild;
  }

  if (data.runTestSuite !== undefined) {
    updateData.runTestSuite = data.runTestSuite;
  }

  if (data.phaseId !== undefined) {
    if (data.phaseId !== null) {
      if (!task.featureId) {
        throw new Error("Cannot assign phase to task without a feature");
      }
      const phase = await db.phase.findFirst({
        where: {
          id: data.phaseId,
          featureId: task.featureId,
        },
      });

      if (!phase) {
        throw new Error("Phase not found or does not belong to this feature");
      }
    }
    updateData.phaseId = data.phaseId;
  }

  if (data.assigneeId !== undefined) {
    if (data.assigneeId !== null) {
      // Skip validation for system assignees
      if (!data.assigneeId.startsWith("system:")) {
        const assignee = await db.user.findUnique({
          where: { id: data.assigneeId },
        });

        if (!assignee) {
          throw new Error("Assignee not found");
        }
      }
    }

    // Handle system assignees
    const isSystemAssignee = data.assigneeId?.startsWith("system:");
    if (isSystemAssignee) {
      updateData.assigneeId = null;
      updateData.systemAssigneeType = data.assigneeId === "system:task-coordinator"
        ? "TASK_COORDINATOR"
        : "BOUNTY_HUNTER";
    } else {
      updateData.assigneeId = data.assigneeId;
      updateData.systemAssigneeType = null;
    }
  }

  if (data.order !== undefined) {
    if (typeof data.order !== "number") {
      throw new Error("Order must be a number");
    }
    updateData.order = data.order;
  }

  if (data.dependsOnTaskIds !== undefined) {
    if (!Array.isArray(data.dependsOnTaskIds)) {
      throw new Error("dependsOnTaskIds must be an array");
    }

    // Prevent task from depending on itself
    if (data.dependsOnTaskIds.includes(taskId)) {
      throw new Error("A task cannot depend on itself");
    }

    // Validate all dependency tasks exist and belong to same feature
    if (data.dependsOnTaskIds.length > 0) {
      const dependencyTasks = await db.task.findMany({
        where: {
          id: { in: data.dependsOnTaskIds },
          deleted: false,
        },
        select: {
          id: true,
          featureId: true,
        },
      });

      if (dependencyTasks.length !== data.dependsOnTaskIds.length) {
        throw new Error("One or more dependency tasks not found");
      }

      // Check all dependency tasks belong to same feature
      const invalidDependencies = dependencyTasks.filter(
        (dep) => dep.featureId !== task.featureId
      );
      if (invalidDependencies.length > 0) {
        throw new Error("Dependencies must be tasks from the same feature");
      }

      // Simple circular dependency check: prevent A->B and B->A
      const existingDependents = await db.task.findMany({
        where: {
          id: { in: data.dependsOnTaskIds },
          dependsOnTaskIds: { has: taskId },
        },
        select: { id: true, title: true },
      });

      if (existingDependents.length > 0) {
        throw new Error(
          `Circular dependency detected with task(s): ${existingDependents.map((t) => t.title).join(", ")}`
        );
      }
    }

    updateData.dependsOnTaskIds = data.dependsOnTaskIds;
  }

  const updatedTask = await db.task.update({
    where: { id: taskId },
    data: updateData,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      bountyCode: true,
      dependsOnTaskIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Sync feature status if task belongs to a feature and status/workflowStatus was changed
  if (updatedTask.featureId && (data.status !== undefined || data.workflowStatus !== undefined)) {
    try {
      await updateFeatureStatusFromTasks(updatedTask.featureId);
    } catch (error) {
      console.error('Failed to sync feature status:', error);
      // Don't fail the request if feature sync fails
    }
  }

  // Convert system assignee type to virtual user object
  if (updatedTask.systemAssigneeType) {
    const systemAssignee = getSystemAssigneeUser(updatedTask.systemAssigneeType);

    if (systemAssignee) {
      return {
        ...updatedTask,
        assignee: systemAssignee,
      };
    }
  }

  return updatedTask;
}

/**
 * Soft deletes a roadmap task
 */
export async function deleteTicket(
  taskId: string,
  userId: string
): Promise<void> {
  const task = await validateRoadmapTaskAccess(taskId, userId);
  if (!task) {
    throw new Error("Task not found or access denied");
  }

  // Clean up orphaned dependencies: Find all tasks that depend on this task
  const dependentTasks = await db.task.findMany({
    where: {
      dependsOnTaskIds: { has: taskId },
      deleted: false,
    },
    select: {
      id: true,
      dependsOnTaskIds: true,
    },
  });

  // Remove the deleted task ID from each dependent task's dependsOnTaskIds array
  for (const dependent of dependentTasks) {
    await db.task.update({
      where: { id: dependent.id },
      data: {
        dependsOnTaskIds: {
          set: dependent.dependsOnTaskIds.filter((id) => id !== taskId),
        },
      },
    });
  }

  // Perform soft-delete
  await db.task.update({
    where: { id: taskId },
    data: {
      deleted: true,
      deletedAt: new Date(),
    },
  });
}

/**
 * Reorders roadmap tasks (within or across phases)
 */
export async function reorderTickets(
  userId: string,
  tasks: { id: string; order: number; phaseId?: string | null }[]
): Promise<RoadmapTaskWithDetails[]> {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("Tasks must be a non-empty array");
  }

  const allTasks = await db.task.findMany({
    where: { id: { in: tasks.map(t => t.id) } },
    select: { id: true, featureId: true },
  });

  if (allTasks.length === 0) {
    throw new Error("Task not found");
  }

  const uniqueFeatureIds = [...new Set(allTasks.map(t => t.featureId).filter(Boolean))];

  if (uniqueFeatureIds.length === 0) {
    throw new Error("Tasks must belong to a feature");
  }

  if (uniqueFeatureIds.length > 1) {
    throw new Error("All tasks must belong to the same feature");
  }

  const featureId = uniqueFeatureIds[0] as string;

  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Access denied");
  }

  await db.$transaction(
    tasks.map((task) => {
      const updateData: any = { order: task.order };
      if (task.phaseId !== undefined) {
        updateData.phaseId = task.phaseId;
      }
      return db.task.update({
        where: {
          id: task.id,
          featureId: featureId,
        },
        data: updateData,
      });
    })
  );

  const updatedTasks = await db.task.findMany({
    where: { featureId: featureId, deleted: false },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      order: true,
      featureId: true,
      phaseId: true,
      bountyCode: true,
      dependsOnTaskIds: true,
      createdAt: true,
      updatedAt: true,
      systemAssigneeType: true,
      assignee: {
        select: USER_SELECT,
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { order: "asc" },
  });

  // Convert system assignee types to virtual user objects
  return updatedTasks.map(task => {
    if (task.systemAssigneeType) {
      const systemAssignee = getSystemAssigneeUser(task.systemAssigneeType);

      if (systemAssignee) {
        return {
          ...task,
          assignee: systemAssignee,
        };
      }
    }
    return task;
  });
}
