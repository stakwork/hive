import { db } from "@/lib/db";
import type {
  CreatePhaseRequest,
  UpdatePhaseRequest,
  PhaseWithDetails,
  PhaseListItem,
} from "@/types/roadmap";
import { validateFeatureAccess, validatePhaseAccess } from "./utils";

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

  const maxOrderPhase = await db.phase.findFirst({
    where: { featureId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const nextOrder = (maxOrderPhase?.order ?? -1) + 1;

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
        select: { tickets: true },
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
        select: { tickets: true },
      },
    },
  });

  return updatedPhase;
}

/**
 * Deletes a phase (tickets will have phaseId set to null)
 */
export async function deletePhase(
  phaseId: string,
  userId: string
): Promise<void> {
  const phase = await validatePhaseAccess(phaseId, userId);
  if (!phase) {
    throw new Error("Phase not found or access denied");
  }

  await db.phase.delete({
    where: { id: phaseId },
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
    where: { featureId },
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
        select: { tickets: true },
      },
    },
    orderBy: { order: "asc" },
  });

  return updatedPhases;
}
