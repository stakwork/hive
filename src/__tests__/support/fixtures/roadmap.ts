import { db } from "@/lib/db";
import type { Feature } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestFeatureOptions {
  title?: string;
  brief?: string;
  requirements?: string;
  architecture?: string;
  workspaceId: string;
  createdById: string;
  updatedById?: string;
  assigneeId?: string;
  status?: "BACKLOG" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Creates a test feature with required fields
 * Useful for integration tests that need feature data
 */
export async function createTestFeature(
  options: CreateTestFeatureOptions,
): Promise<Feature> {
  const uniqueId = generateUniqueId("feature");

  return db.feature.create({
    data: {
      title: options.title || `Test Feature ${uniqueId}`,
      brief: options.brief || null,
      requirements: options.requirements || null,
      architecture: options.architecture || null,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.updatedById || options.createdById,
      assigneeId: options.assigneeId || null,
      status: options.status || "BACKLOG",
      priority: options.priority || "NONE",
    },
  });
}
