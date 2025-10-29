import { db } from "@/lib/db";
import type { Phase } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestPhaseOptions {
  name?: string;
  featureId: string;
  order?: number;
}

/**
 * Creates a test phase in the database with sensible defaults
 */
export async function createTestPhase(
  options: CreateTestPhaseOptions
): Promise<Phase> {
  const uniqueId = generateUniqueId("phase");

  return db.phase.create({
    data: {
      name: options.name || `Test Phase ${uniqueId}`,
      featureId: options.featureId,
      order: options.order !== undefined ? options.order : 0,
    },
  });
}
