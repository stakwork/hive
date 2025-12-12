import { db } from "@/lib/db";
import type { CreatePhaseRequest, UpdatePhaseRequest, PhaseListItem, PhaseWithTasks } from "@/types/roadmap";
import { validateFeatureAccess, validatePhaseAccess, calculateNextOrder } from "./utils";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";

/**
 * Simple hash function to convert string to integer for advisory locks
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Gets a phase with its tasks and feature context
 */
export async function getPhase(phaseId: string, userId: string): Promise<PhaseWithTasks> {
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
          bountyCode: true,
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
  const tasksWithConvertedAssignees = phaseWithTasks.tasks.map((task) => {
    if (task.systemAssigneeType) {
      const systemAssignee =
        task.systemAssigneeType === "TASK_COORDINATOR"
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
export async function createPhase(featureId: string, userId: string, data: CreatePhaseRequest): Promise<PhaseListItem> {
  const feature = await validateFeatureAccess(featureId, userId);
  if (!feature) {
    throw new Error("Feature not found or access denied");
  }

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    throw new Error("Name is required");
  }

  // Use transaction with advisory lock to prevent race condition in concurrent phase creation
  const phase = await db.$transaction(async (tx) => {
    // Use advisory lock based on featureId to serialize order calculation
    // The lock is automatically released at end of transaction
    const lockId = Math.abs(hashString(featureId));
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockId})`);

    // Calculate next order within locked transaction to ensure atomicity
    const maxOrderItem = await tx.phase.findFirst({
      where: { featureId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const nextOrder = (maxOrderItem?.order ?? -1) + 1;

    return await tx.phase.create({
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
  });

  return phase;
}

/**
 * Updates a phase
 */
export async function updatePhase(phaseId: string, userId: string, data: UpdatePhaseRequest): Promise<PhaseListItem> {
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
export async function deletePhase(phaseId: string, userId: string): Promise<void> {
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
  phases: { id: string; order: number }[],
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
      }),
    ),
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
