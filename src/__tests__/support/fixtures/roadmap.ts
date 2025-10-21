import { db } from "@/lib/db";
import type { Feature, Phase } from "@prisma/client";

export async function createTestFeature(
  data: {
    title: string;
    workspaceId: string;
    createdById: string;
    description?: string;
  }
): Promise<Feature> {
  return db.feature.create({
    data: {
      title: data.title,
      workspaceId: data.workspaceId,
      createdById: data.createdById,
      updatedById: data.createdById,
      description: data.description,
    },
  });
}

export async function createTestPhase(
  data: {
    name: string;
    featureId: string;
    order?: number;
    description?: string;
  }
): Promise<Phase> {
  return db.phase.create({
    data: {
      name: data.name,
      featureId: data.featureId,
      order: data.order ?? 0,
      description: data.description,
    },
  });
}
