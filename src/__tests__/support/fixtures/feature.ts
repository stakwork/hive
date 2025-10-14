import { db } from "@/lib/db";
import type { Feature } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { createTestUser } from "./user";

export interface CreateTestFeatureOptions {
  workspaceId: string;
  title?: string;
  description?: string | null;
  status?: "BACKLOG" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  createdById?: string;
  updatedById?: string;
  assigneeId?: string | null;
}

export async function createTestFeature(
  options: CreateTestFeatureOptions
): Promise<Feature> {
  const uniqueId = generateUniqueId("feature");

  // Create a default user if createdById/updatedById not provided
  let createdById = options.createdById;
  let updatedById = options.updatedById;
  
  if (!createdById || !updatedById) {
    const defaultUser = await createTestUser({ name: "Feature Creator" });
    createdById = createdById || defaultUser.id;
    updatedById = updatedById || defaultUser.id;
  }

  return db.feature.create({
    data: {
      title: options.title || `Test Feature ${uniqueId}`,
      brief: options.description === undefined ? null : options.description,
      workspaceId: options.workspaceId,
      status: options.status || "BACKLOG",
      priority: options.priority || "NONE",
      createdById,
      updatedById,
      assigneeId: options.assigneeId === undefined ? null : options.assigneeId,
    },
  });
}