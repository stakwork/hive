import { db } from "@/lib/db";
import {
  CreateWorkspaceRequest,
  WorkspaceResponse,
  WorkspaceWithRole,
  WorkspaceRole,
} from "@/types/workspace";
import { WORKSPACE_ERRORS } from "@/lib/constants";
import { validateWorkspaceSlug } from "./workspace-validation";
import { getWorkspaceBySlug } from "./workspace-access";

/**
 * Creates a new workspace
 */
export async function createWorkspace(
  data: CreateWorkspaceRequest,
): Promise<WorkspaceResponse> {
  const slugValidation = validateWorkspaceSlug(data.slug);
  if (!slugValidation.isValid) {
    throw new Error(slugValidation.error!);
  }

  const existing = await db.workspace.findUnique({
    where: { slug: data.slug, deleted: false },
  });
  if (existing) {
    throw new Error(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
  }

  try {
    const workspace = await db.workspace.create({
      data: {
        name: data.name,
        description: data.description,
        slug: data.slug,
        ownerId: data.ownerId,
      },
    });
    return {
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002" &&
      "meta" in error &&
      error.meta &&
      typeof error.meta === "object" &&
      "target" in error.meta &&
      Array.isArray(error.meta.target) &&
      error.meta.target.includes("slug")
    ) {
      throw new Error(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    }
    throw error;
  }
}

/**
 * Gets all workspaces owned by a user
 */
export async function getWorkspacesByUserId(
  userId: string,
): Promise<WorkspaceResponse[]> {
  const workspaces = await db.workspace.findMany({
    where: { ownerId: userId, deleted: false },
  });

  return workspaces.map((workspace) => ({
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }));
}

/**
 * Gets all workspaces a user has access to, including their role
 */
export async function getUserWorkspaces(
  userId: string,
): Promise<WorkspaceWithRole[]> {
  const result: WorkspaceWithRole[] = [];

  // Get owned workspaces
  const ownedWorkspaces = await db.workspace.findMany({
    where: {
      ownerId: userId,
      deleted: false,
    },
  });

  // Add owned workspaces with member count
  for (const workspace of ownedWorkspaces) {
    const memberCount = await db.workspaceMember.count({
      where: { workspaceId: workspace.id, leftAt: null },
    });

    result.push({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      userRole: "OWNER",
      memberCount: memberCount + 1, // +1 for owner
    });
  }

  // Get member workspaces
  const memberships = await db.workspaceMember.findMany({
    where: {
      userId,
      leftAt: null,
    },
    include: {
      workspace: true,
    },
  });

  // Add member workspaces
  for (const membership of memberships) {
    if (membership.workspace && !membership.workspace.deleted) {
      const memberCount = await db.workspaceMember.count({
        where: { workspaceId: membership.workspace.id, leftAt: null },
      });

      result.push({
        id: membership.workspace.id,
        name: membership.workspace.name,
        description: membership.workspace.description,
        slug: membership.workspace.slug,
        ownerId: membership.workspace.ownerId,
        createdAt: membership.workspace.createdAt.toISOString(),
        updatedAt: membership.workspace.updatedAt.toISOString(),
        userRole: membership.role as WorkspaceRole,
        memberCount: memberCount + 1, // +1 for owner
      });
    }
  }

  // Sort by name and return
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Gets the user's default/primary workspace (first owned, then first member)
 */
export async function getDefaultWorkspaceForUser(
  userId: string,
): Promise<WorkspaceResponse | null> {
  // Try to get the first owned workspace
  const ownedWorkspace = await db.workspace.findFirst({
    where: {
      ownerId: userId,
      deleted: false,
    },
    orderBy: { createdAt: "asc" },
  });

  if (ownedWorkspace) {
    return {
      ...ownedWorkspace,
      createdAt: ownedWorkspace.createdAt.toISOString(),
      updatedAt: ownedWorkspace.updatedAt.toISOString(),
    };
  }

  // Get first workspace where user is a member
  const membership = await db.workspaceMember.findFirst({
    where: {
      userId,
      leftAt: null,
    },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  });

  if (membership?.workspace) {
    return {
      ...membership.workspace,
      createdAt: membership.workspace.createdAt.toISOString(),
      updatedAt: membership.workspace.updatedAt.toISOString(),
    };
  }

  return null;
}

/**
 * Deletes a workspace by slug if user has admin access (owner)
 */
export async function deleteWorkspaceBySlug(
  slug: string,
  userId: string,
): Promise<void> {
  // First check if user has access and is owner
  const workspace = await getWorkspaceBySlug(slug, userId);

  if (!workspace) {
    throw new Error("Workspace not found or access denied");
  }

  if (workspace.userRole !== "OWNER") {
    throw new Error("Only workspace owners can delete workspaces");
  }

  // Soft delete the workspace
  await softDeleteWorkspace(workspace.id);
}

/**
 * Soft deletes a workspace by ID
 */
export async function softDeleteWorkspace(workspaceId: string): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { 
      deleted: true,
      deletedAt: new Date()
    },
  });
}