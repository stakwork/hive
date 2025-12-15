import { db } from "@/lib/db";
import type { Feature } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestFeatureOptions {
  title?: string;
  brief?: string;
  workspaceId: string;
  createdById: string;
  updatedById: string;
  assigneeId?: string;
  status?: "BACKLOG" | "PLANNED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority?: "LOW" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requirements?: string;
  architecture?: string;
  personas?: string[];
}

export async function createTestFeature(
  options: CreateTestFeatureOptions,
): Promise<Feature> {
  const uniqueId = generateUniqueId("feature");

  return db.feature.create({
    data: {
      title: options.title || `Test Feature ${uniqueId}`,
      brief: options.brief || `Test feature brief ${uniqueId}`,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.updatedById,
      assigneeId: options.assigneeId || null,
      status: options.status || "BACKLOG",
      priority: options.priority || "LOW",
      requirements: options.requirements || null,
      architecture: options.architecture || null,
      personas: options.personas || [],
    },
  });
}
