import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "./index";
import type { User, Workspace, Feature, Phase } from "@prisma/client";

/**
 * Setup context for ticket/feature tests
 */
export interface TicketTestContext {
  user: User;
  workspace: Workspace;
  feature: Feature;
}

/**
 * Setup context with phase for ticket tests
 */
export interface TicketTestContextWithPhase extends TicketTestContext {
  phase: Phase;
}

/**
 * Creates a standard test environment for ticket API tests
 * Includes: user, workspace, and feature
 */
export async function createTicketTestContext(
  workspaceName = "Test Workspace",
  featureTitle = "Test Feature"
): Promise<TicketTestContext> {
  const user = await createTestUser();
  const workspace = await createTestWorkspace({
    ownerId: user.id,
    name: workspaceName,
    slug: workspaceName.toLowerCase().replace(/\s+/g, "-"),
  });

  const feature = await db.feature.create({
    data: {
      title: featureTitle,
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
    },
  });

  return { user, workspace, feature };
}

/**
 * Creates a test environment with a phase for ticket API tests
 * Includes: user, workspace, feature, and phase
 */
export async function createTicketTestContextWithPhase(
  workspaceName = "Test Workspace",
  featureTitle = "Test Feature",
  phaseName = "Development"
): Promise<TicketTestContextWithPhase> {
  const context = await createTicketTestContext(workspaceName, featureTitle);

  const phase = await db.phase.create({
    data: {
      name: phaseName,
      featureId: context.feature.id,
      order: 0,
      createdById: context.user.id,
      updatedById: context.user.id,
    },
  });

  return { ...context, phase };
}

/**
 * Creates an existing ticket for a feature (useful for order testing)
 */
export async function createExistingTicket(
  featureId: string,
  workspaceId: string,
  userId: string,
  title: string,
  order: number
) {
  return db.task.create({
    data: {
      title,
      workspaceId,
      featureId,
      order,
      createdById: userId,
      updatedById: userId,
    },
  });
}
