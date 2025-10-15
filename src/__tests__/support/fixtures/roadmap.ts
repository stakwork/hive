import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers";

interface CreateTestFeatureOptions {
  title?: string;
  workspaceId: string;
  createdById: string;
  updatedById?: string;
  description?: string;
  deleted?: boolean;
}

export async function createTestFeature(options: CreateTestFeatureOptions) {
  return await db.feature.create({
    data: {
      title: options.title || "Test Feature",
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.updatedById || options.createdById,
      description: options.description,
      deleted: options.deleted || false,
    },
  });
}

interface CreateTestPhaseOptions {
  name?: string;
  featureId: string;
  order?: number;
}

export async function createTestPhase(options: CreateTestPhaseOptions) {
  return await db.phase.create({
    data: {
      name: options.name || "Test Phase",
      featureId: options.featureId,
      order: options.order ?? 0,
    },
  });
}

interface CreateTestTicketOptions {
  title?: string;
  featureId: string;
  createdById: string;
  updatedById?: string;
  description?: string;
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  phaseId?: string;
  assigneeId?: string;
  order?: number;
}

export async function createTestTicket(options: CreateTestTicketOptions) {
  return await db.ticket.create({
    data: {
      title: options.title || "Test Ticket",
      featureId: options.featureId,
      createdById: options.createdById,
      updatedById: options.updatedById || options.createdById,
      description: options.description,
      status: options.status || "TODO",
      priority: options.priority || "MEDIUM",
      phaseId: options.phaseId,
      assigneeId: options.assigneeId,
      order: options.order ?? 0,
    },
  });
}
