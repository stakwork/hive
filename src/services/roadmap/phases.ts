import { db } from "@/lib/db";
import { SystemAssigneeType } from "@prisma/client";
import type {
  CreatePhaseRequest,
  UpdatePhaseRequest,
  PhaseWithDetails,
  PhaseListItem,
  PhaseWithTasks,
} from "@/types/roadmap";
import { validateFeatureAccess, validatePhaseAccess, calculateNextOrder } from "./utils";

/**
 * Gets a phase with its tasks and feature context
 */
export async function getPhase(
  phaseId: string,
  userId: string
): Promise<PhaseWithTasks> {
  const phase = await validatePhaseAccess(phaseId, userId);
  if (!phase) {
    throw new Error("Phase not found or access denied");
  }

  const phaseWithTasks = await db.phase.findUnique({
    where: { id: phaseId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      order: true,
      featureId: true,
      createdAt: true,
      updatedAt: true,
      feature: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      },
      tasks: {
        where: {
          deleted: false,
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
          dependsOnTaskIds: true,
          createdAt: true,
          updatedAt: true,
          systemAssigneeType: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          phase: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          order: "asc",
        },
      },
    },
  });

  if (!phaseWithTasks) {
    throw new Error("Phase not found");
  }

  // Convert system assignee types to virtual user objects
  const tasksWithConvertedAssignees = phaseWithTasks.tasks.map(task => {
    if (task.systemAssigneeType) {
      const systemAssignee = task.systemAssigneeType === "TASK_COORDINATOR"
        ? {
            id: "system:task-coordinator",
            name: "Task Coordinator",
            email: null,
            image: null,
          }
        : {
            id: "system:bounty-hunter",
            name: "Bounty Hunter",
            email: null,
            image: "/sphinx_icon.png",
          };

      return {
        ...task,
        assignee: systemAssignee,
      };
    }
    return task;
  });

  return {
    ...phaseWithTasks,
    tasks: tasksWithConvertedAssignees,
  };
}

/**
 * Creates a new phase for a feature
 */
export async function createPhase(
  featureId: string,
  userId: string,
  data: CreatePhaseRequest
): Promise<PhaseListItem> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    throw new Error("Name is required");
  }

  const nextOrder = await calculateNextOrder(db.phase, { featureId });

  const phase = await db.phase.create({
    data: {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      featureId,
      order: nextOrder,
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      order: true,
      featureId: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { tasks: true },
      },
    },
  });

  return phase;
}

/**
 * Updates a phase
 */
export async function updatePhase(
  phaseId: string,
  userId: string,
  data: UpdatePhaseRequest
): Promise<PhaseListItem> {
  const phase = await validatePhaseAccess(phaseId, userId);
  if (!phase) {
    throw new Error("Phase not found or access denied");
  }

  const updateData: any = {};

  if (data.name !== undefined) {
    if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
      throw new Error("Name cannot be empty");
    }
    updateData.name = data.name.trim();
  }

  if (data.description !== undefined) {
    updateData.description = data.description?.trim() || null;
  }

  if (data.status !== undefined) {
    updateData.status = data.status;
  }

  if (data.order !== undefined) {
    if (typeof data.order !== "number") {
      throw new Error("Order must be a number");
    }
    updateData.order = data.order;
  }

  const updatedPhase = await db.phase.update({
    where: { id: phaseId },
    data: updateData,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      order: true,
      featureId: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { tasks: true },
      },
    },
  });

  return updatedPhase;
}

/**
 * Soft deletes a phase (tickets will have phaseId set to null)
 */
export async function deletePhase(
  phaseId: string,
  userId: string
): Promise<void> {
  const phase = await validatePhaseAccess(phaseId, userId);
  if (!phase) {
    throw new Error("Phase not found or access denied");
  }

  await db.phase.update({
    where: { id: phaseId },
    data: {
      deleted: true,
      deletedAt: new Date(),
    },
  });
}

/**
 * Reorders phases within a feature
 */
export async function reorderPhases(
  featureId: string,
  userId: string,
  phases: { id: string; order: number }[]
): Promise<PhaseListItem[]> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  if (!Array.isArray(phases)) {
    throw new Error("Phases must be an array");
  }

  await db.$transaction(
    phases.map((phase) =>
      db.phase.update({
        where: {
          id: phase.id,
          featureId: featureId,
        },
        data: { order: phase.order },
      })
    )
  );

  const updatedPhases = await db.phase.findMany({
    where: { featureId, deleted: false },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      order: true,
      featureId: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { tasks: true },
      },
    },
    orderBy: { order: "asc" },
  });

  return updatedPhases;
}

/**
 * Batch creates phases with tasks from AI generation
 * Handles dependency mapping from tempIds to real task IDs
 */
export async function batchCreatePhasesWithTasks(
  featureId: string,
  userId: string,
  phases: Array<{
    name: string;
    description?: string;
    tasks: Array<{
      title: string;
      description?: string;
      priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      tempId: string;
      dependsOn?: string[];
    }>;
  }>
): Promise<Array<{ phase: PhaseListItem; tasks: any[] }>> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Use transaction to ensure atomicity
  return await db.$transaction(async (tx) => {
    const result: Array<{ phase: PhaseListItem; tasks: any[] }> = [];
    const tempIdToRealId = new Map<string, string>();

    // Calculate starting order for phases
    const existingPhases = await tx.phase.findMany({
      where: { featureId },
      select: { order: true },
      orderBy: { order: "desc" },
      take: 1,
    });

    const basePhaseOrder = existingPhases.length > 0 ? existingPhases[0].order + 1 : 0;

    // Create phases and tasks
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phaseData = phases[phaseIndex];

      // Create phase
      const phase = await tx.phase.create({
        data: {
          name: phaseData.name.trim(),
          description: phaseData.description?.trim() || null,
          featureId,
          order: basePhaseOrder + phaseIndex,
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          order: true,
          featureId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { tasks: true },
          },
        },
      });

      const tasks = [];

      // Create tasks for this phase
      for (let taskIndex = 0; taskIndex < phaseData.tasks.length; taskIndex++) {
        const taskData = phaseData.tasks[taskIndex];

        // Map dependsOn tempIds to real IDs (if dependencies are already created)
        const dependsOnTaskIds = taskData.dependsOn
          ? taskData.dependsOn.map((tempId) => tempIdToRealId.get(tempId)).filter(Boolean) as string[]
          : [];

        const task = await tx.task.create({
          data: {
            title: taskData.title.trim(),
            description: taskData.description?.trim() || null,
            workspaceId: feature.workspaceId,
            featureId,
            phaseId: phase.id,
            priority: taskData.priority,
            status: "TODO",
            order: taskIndex,
            dependsOnTaskIds,
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
            dependsOnTaskIds: true,
            createdAt: true,
            updatedAt: true,
            systemAssigneeType: true,
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              },
            },
            phase: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Map tempId to real ID for dependency resolution
        tempIdToRealId.set(taskData.tempId, task.id);
        tasks.push(task);
      }

      // Update task count for phase
      phase._count.tasks = tasks.length;

      result.push({ phase, tasks });
    }

    return result;
  });
}

// Backwards compatibility alias
export const batchCreatePhasesWithTickets = batchCreatePhasesWithTasks;
