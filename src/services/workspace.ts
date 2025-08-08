import { db } from "@/lib/db";
import {
  CreateWorkspaceRequest,
  WorkspaceResponse,
  WorkspaceWithRole,
  WorkspaceWithAccess,
  WorkspaceAccessValidation,
  WorkspaceRole,
} from "@/types/workspace";
import {
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS,
  WORKSPACE_ERRORS,
  WORKSPACE_PERMISSION_LEVELS,
} from "@/lib/constants";

// Type assertion to help IDE recognize Prisma client methods

// Existing functions
export async function createWorkspace(
  data: CreateWorkspaceRequest,
): Promise<WorkspaceResponse> {
  // Validate the slug before creating
  const slugValidation = validateWorkspaceSlug(data.slug);
  if (!slugValidation.isValid) {
    throw new Error(slugValidation.error!);
  }

  // Check if the slug already exists
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

export async function getWorkspacesByUserId(
  userId: string,
): Promise<WorkspaceResponse[]> {
  const workspaces = await db.workspace.findMany({
    where: { ownerId: userId, deleted: false },
  });

  return workspaces.map((workspace: any) => ({
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }));
}

/**
 * Gets a workspace by slug if user has access (owner or member)
 */
export async function getWorkspaceBySlug(
  slug: string,
  userId: string,
): Promise<WorkspaceWithAccess | null> {
  // Get the workspace with owner info and swarm status
  const workspace = await db.workspace.findFirst({
    where: {
      slug,
      deleted: false,
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true },
      },
      swarm: {
        select: { id: true, status: true },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  // Check if user is owner
  if (workspace.ownerId === userId) {
    return {
      id: workspace.id,
      name: workspace.name,
      hasKey: !!workspace.stakworkApiKey,
      description: workspace.description,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      userRole: "OWNER",
      owner: workspace.owner,
      isCodeGraphSetup:
        workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
    };
  }

  // Check if user is a member
  const membership = await db.workspaceMember.findFirst({
    where: {
      workspaceId: workspace.id,
      userId,
      leftAt: null,
    },
  });

  if (!membership) {
    return null; // User has no access
  }

  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    slug: workspace.slug,
    ownerId: workspace.ownerId,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
    userRole: membership.role as WorkspaceRole,
    owner: workspace.owner,
    hasKey: !!workspace.stakworkApiKey,
    isCodeGraphSetup:
      workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
  };
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
 * Validates user access to a workspace and returns permission details
 */
export async function validateWorkspaceAccess(
  slug: string,
  userId: string,
): Promise<WorkspaceAccessValidation> {
  const workspace = await getWorkspaceBySlug(slug, userId);

  if (!workspace) {
    return {
      hasAccess: false,
      canRead: false,
      canWrite: false,
      canAdmin: false,
    };
  }

  const roleLevel = WORKSPACE_PERMISSION_LEVELS[workspace.userRole];

  return {
    hasAccess: true,
    userRole: workspace.userRole,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    canRead: roleLevel >= WORKSPACE_PERMISSION_LEVELS.VIEWER,
    canWrite: roleLevel >= WORKSPACE_PERMISSION_LEVELS.DEVELOPER,
    canAdmin: roleLevel >= WORKSPACE_PERMISSION_LEVELS.ADMIN,
  };
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

// Enhanced functions

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
 * Validates a workspace slug against reserved words and format requirements
 */
export function validateWorkspaceSlug(slug: string): {
  isValid: boolean;
  error?: string;
} {
  // Check length
  if (
    slug.length < WORKSPACE_SLUG_PATTERNS.MIN_LENGTH ||
    slug.length > WORKSPACE_SLUG_PATTERNS.MAX_LENGTH
  ) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH };
  }

  // Check format (lowercase alphanumeric with hyphens, start/end with alphanumeric)
  if (!WORKSPACE_SLUG_PATTERNS.VALID.test(slug)) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT };
  }

  // Check against reserved slugs
  if (
    RESERVED_WORKSPACE_SLUGS.includes(
      slug as (typeof RESERVED_WORKSPACE_SLUGS)[number],
    )
  ) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_RESERVED };
  }

  return { isValid: true };
}
