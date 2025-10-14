import { db } from "@/lib/db";
import type { Phase, PhaseStatus } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestPhaseOptions {
  featureId: string;
  name?: string;
  description?: string | null;
  status?: PhaseStatus;
  order?: number;
}

export async function createTestPhase(
  options: CreateTestPhaseOptions
): Promise<Phase> {
  const uniqueId = generateUniqueId("phase");

  return db.phase.create({
    data: {
      name: options.name || `Test Phase ${uniqueId}`,
      description: options.description === undefined ? null : options.description,
      featureId: options.featureId,
      status: options.status || "NOT_STARTED",
      order: options.order ?? 0,
    },
  });
}

export async function createTestPhases(
  featureId: string,
  count: number
): Promise<Phase[]> {
  const phases: Phase[] = [];

  for (let i = 0; i < count; i++) {
    const phase = await createTestPhase({
      featureId,
      name: `Test Phase ${i + 1}`,
      order: i,
    });
    phases.push(phase);
  }

  return phases;
}