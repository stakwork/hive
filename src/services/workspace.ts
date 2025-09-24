import {
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
  WORKSPACE_PERMISSION_LEVELS,
  WORKSPACE_SLUG_PATTERNS,
} from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createWorkspaceMember,
  findActiveMember,
  findPreviousMember,
  findUserByGitHubUsername,
  getActiveWorkspaceMembers,
  isWorkspaceOwner,
  reactivateWorkspaceMember,
  softDeleteMember,
  updateMemberRole,
} from "@/lib/helpers/workspace-member-queries";
import { mapWorkspaceMember, mapWorkspaceMembers } from "@/lib/mappers/workspace-member";
import {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  WorkspaceAccessValidation,
  WorkspaceResponse,
  WorkspaceWithAccess,
  WorkspaceWithRole,
} from "@/types/workspace";
import { WorkspaceRole } from "@prisma/client";

const encryptionService: EncryptionService = EncryptionService.getInstance();

/**
 * Helper function to determine if workspace has a valid API key
 */
function hasValidApiKey(stakworkApiKey: string | null): boolean {
  if (!stakworkApiKey) {
    return false;
  }

  try {
    const decryptedKey = encryptionService.decryptField("stakworkApiKey", stakworkApiKey);
    return !!decryptedKey && decryptedKey.trim().length > 0;
  } catch {
    return false;
  }
}

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

  // Check workspace limit for the user
  const existingWorkspacesCount = await db.workspace.count({
    where: { ownerId: data.ownerId, deleted: false },
  });

  if (existingWorkspacesCount >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER) {
    throw new Error(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);
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

  return workspaces.map((workspace) => ({
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }));
}

/**
 * Gets a workspace by ID if user has access (owner or member)
 */
export async function getWorkspaceById(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceWithAccess | null> {
  // Get the workspace with owner info, swarm status, and repositories
  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      deleted: false,
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true },
      },
      swarm: {
        select: { id: true, status: true, ingestRefId: true, poolState: true },
      },
      repositories: {
        select: {
          id: true,
          name: true,
          repositoryUrl: true,
          branch: true,
          status: true,
          updatedAt: true,

        },
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
      hasKey: hasValidApiKey(workspace.stakworkApiKey),
      description: workspace.description,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      userRole: "OWNER",
      owner: workspace.owner,
      isCodeGraphSetup:
        workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
      swarmStatus: workspace.swarm?.status || null,
      ingestRefId: workspace.swarm?.ingestRefId || null,
      poolState: workspace.swarm?.poolState || null,
      repositories: workspace.repositories?.map((repo) => ({
        ...repo,
        updatedAt: repo.updatedAt.toISOString(),
      })) || [],
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
    hasKey: hasValidApiKey(workspace.stakworkApiKey),
    isCodeGraphSetup:
      workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
    swarmStatus: workspace.swarm?.status || null,
    ingestRefId: workspace.swarm?.ingestRefId || null,
    poolState: workspace.swarm?.poolState || null,
    repositories: workspace.repositories?.map((repo) => ({
      ...repo,
      updatedAt: repo.updatedAt.toISOString(),
    })) || [],
  };
}

/**
 * Gets a workspace by slug if user has access (owner or member)
 */
export async function getWorkspaceBySlug(
  slug: string,
  userId: string,
): Promise<WorkspaceWithAccess | null> {
  // Get the workspace with owner info, swarm status, and repositories
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
        select: { id: true, status: true, ingestRefId: true, poolState: true },
      },
      repositories: {
        select: {
          id: true,
          name: true,
          repositoryUrl: true,
          branch: true,
          status: true,
          updatedAt: true,
        },
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
      hasKey: hasValidApiKey(workspace.stakworkApiKey),
      description: workspace.description,
      slug: workspace.slug,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      userRole: "OWNER",
      owner: workspace.owner,
      isCodeGraphSetup:
        workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
      swarmStatus: workspace.swarm?.status || null,
      ingestRefId: workspace.swarm?.ingestRefId || null,
      poolState: workspace.swarm?.poolState || null,
      repositories: workspace.repositories?.map((repo) => ({
        ...repo,
        updatedAt: repo.updatedAt.toISOString(),
      })) || [],
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
    hasKey: hasValidApiKey(workspace.stakworkApiKey),
    isCodeGraphSetup:
      workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
    swarmStatus: workspace.swarm?.status || null,
    ingestRefId: workspace.swarm?.ingestRefId || null,
    poolState: workspace.swarm?.poolState || null,
    repositories: workspace.repositories?.map((repo) => ({
      ...repo,
      updatedAt: repo.updatedAt.toISOString(),
    })) || [],
  };
}

/**
 * Gets all workspaces a user has access to, including their role
 */
export async function getUserWorkspaces(
  userId: string,
): Promise<WorkspaceWithRole[]> {
  // Get all workspaces the user owns or is a member of in a single query
  const [ownedWorkspaces, memberships] = await Promise.all([
    db.workspace.findMany({
      where: {
        ownerId: userId,
        deleted: false,
      },
    }),
    db.workspaceMember.findMany({
      where: {
        userId,
        leftAt: null,
      },
      include: {
        workspace: true,
      },
    }),
  ]);

  // Get all workspace IDs to batch the member count query
  const allWorkspaceIds = [
    ...ownedWorkspaces.map(w => w.id),
    ...memberships
      .filter(m => m.workspace && !m.workspace.deleted)
      .map(m => m.workspace!.id)
  ];

  // Get all member counts in a single query if we have workspace IDs
  const memberCountMap: Record<string, number> = {};
  if (allWorkspaceIds.length > 0) {
    const allMembers = await db.workspaceMember.findMany({
      where: {
        workspaceId: { in: allWorkspaceIds },
        leftAt: null,
      },
      select: {
        workspaceId: true,
      },
    });

    // Count members per workspace
    for (const member of allMembers) {
      memberCountMap[member.workspaceId] = (memberCountMap[member.workspaceId] || 0) + 1;
    }
  }

  const result: WorkspaceWithRole[] = [];

  // Add owned workspaces
  for (const workspace of ownedWorkspaces) {
    const memberCount = memberCountMap[workspace.id] || 0;
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

  // Add member workspaces
  for (const membership of memberships) {
    if (membership.workspace && !membership.workspace.deleted) {
      const memberCount = memberCountMap[membership.workspace.id] || 0;
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

  const roleLevel = WORKSPACE_PERMISSION_LEVELS[workspace.userRole as WorkspaceRole];

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
    canRead: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER],
    canWrite: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER],
    canAdmin: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN],
  };
}

/**
 * Validates user access to a workspace by ID and returns permission details
 */
export async function validateWorkspaceAccessById(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccessValidation> {
  const workspace = await getWorkspaceById(workspaceId, userId);

  if (!workspace) {
    return {
      hasAccess: false,
      canRead: false,
      canWrite: false,
      canAdmin: false,
    };
  }

  const roleLevel = WORKSPACE_PERMISSION_LEVELS[workspace.userRole as WorkspaceRole];

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
    canRead: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER],
    canWrite: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER],
    canAdmin: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN],
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

  // Get the current workspace to access its slug
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId }
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const timestamp = Date.now();
  const deletedSlug = `${workspace.slug}-deleted-${timestamp}`;

  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      deleted: true,
      deletedAt: new Date(),
      originalSlug: workspace.slug, // Store original slug for recovery
      slug: deletedSlug // Modify slug to allow reuse of original
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

  const swarm = await db.swarm.findFirst({
    where: {
      workspaceId: workspace.id,
    },
    select: {
      id: true,
      poolApiKey: true,
    },
  });

  if (swarm && swarm.poolApiKey) {
    const poolName = swarm.id;

    try {
      const decryptedApiKey = encryptionService.decryptField("poolApiKey", swarm.poolApiKey);

      if (decryptedApiKey) {
        const poolManagerUrl = process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api";
        const response = await fetch(`${poolManagerUrl}/pools/${poolName}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${decryptedApiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Pool deletion failed with status ${response.status}`);
        }
      }
    } catch (error) {
      console.error(`Failed to delete pool ${poolName} for workspace ${slug}:`, error);
    }
  }

  await softDeleteWorkspace(workspace.id);
}

/**
 * Recovers a soft-deleted workspace by ID
 */
export async function recoverWorkspace(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceResponse> {
  // Get the deleted workspace
  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      ownerId: userId,
      deleted: true
    }
  });

  if (!workspace) {
    throw new Error("Deleted workspace not found or access denied");
  }

  if (!workspace.originalSlug) {
    throw new Error("Cannot recover workspace: original slug not stored");
  }

  // Check if original slug is available
  const existingWorkspace = await db.workspace.findFirst({
    where: {
      slug: workspace.originalSlug,
      deleted: false
    }
  });

  // Determine the slug to use for recovery
  const recoveredSlug = existingWorkspace
    ? `${workspace.originalSlug}-recovered-${Date.now()}`
    : workspace.originalSlug;

  // Recover the workspace
  const recoveredWorkspace = await db.workspace.update({
    where: { id: workspaceId },
    data: {
      deleted: false,
      deletedAt: null,
      slug: recoveredSlug,
      originalSlug: null // Clear original slug after recovery
    }
  });

  return {
    ...recoveredWorkspace,
    createdAt: recoveredWorkspace.createdAt.toISOString(),
    updatedAt: recoveredWorkspace.updatedAt.toISOString(),
  };
}

/**
 * Validates a workspace slug against reserved words and format requirements
 */
export function validateWorkspaceSlug(slug: string): {
  isValid: boolean;
  error?: string;
} {
  // Handle null/undefined inputs
  if (slug == null) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT };
  }

  // Check length
  if (
    slug.length < WORKSPACE_SLUG_PATTERNS.MIN_LENGTH ||
    slug.length > WORKSPACE_SLUG_PATTERNS.MAX_LENGTH
  ) {
    return { isValid: false, error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH };
  }

  // Check format (lowercase alphanumeric with hyphens, start/end with alphanumeric, no consecutive hyphens)
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

// =============================================
// WORKSPACE MEMBER MANAGEMENT
// =============================================

/**
 * Gets all members and owner information for a workspace
 */
export async function getWorkspaceMembers(workspaceId: string) {
  // Get regular members from workspace_members table
  const members = await getActiveWorkspaceMembers(workspaceId);

  // Get workspace owner information
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: {
        include: {
          githubAuth: {
            select: {
              githubUsername: true,
              name: true,
              bio: true,
              publicRepos: true,
              followers: true,
            },
          },
        },
      },
    },
  });

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  // Map owner to WorkspaceMember format for consistent UI
  const owner = {
    id: workspace.owner.id, // Use real user ID
    userId: workspace.owner.id,
    role: "OWNER" as const,
    joinedAt: workspace.createdAt.toISOString(),
    user: {
      id: workspace.owner.id,
      name: workspace.owner.name,
      email: workspace.owner.email,
      image: workspace.owner.image,
      github: workspace.owner.githubAuth
        ? {
          username: workspace.owner.githubAuth.githubUsername,
          name: workspace.owner.githubAuth.name,
          bio: workspace.owner.githubAuth.bio,
          publicRepos: workspace.owner.githubAuth.publicRepos,
          followers: workspace.owner.githubAuth.followers,
        }
        : null,
    },
  };

  return {
    members: mapWorkspaceMembers(members),
    owner,
  };
}

/**
 * Adds an existing Hive user to a workspace by GitHub username
 * Note: User must already be registered in the system
 */
export async function addWorkspaceMember(
  workspaceId: string,
  githubUsername: string,
  role: WorkspaceRole,
) {
  // Find existing user by GitHub username
  const githubAuth = await findUserByGitHubUsername(githubUsername);
  if (!githubAuth) {
    throw new Error("User not found. They must sign up to Hive first.");
  }

  const userId = githubAuth.userId;

  // Check if user is already an active member
  const activeMember = await findActiveMember(workspaceId, userId);
  if (activeMember) {
    throw new Error("User is already a member of this workspace");
  }

  // Check if user is the workspace owner
  const isOwner = await isWorkspaceOwner(workspaceId, userId);
  if (isOwner) {
    throw new Error("Cannot add workspace owner as a member");
  }

  // Check if user was previously a member (soft deleted)
  const previousMember = await findPreviousMember(workspaceId, userId);

  // Add the member (either create new or reactivate previous)
  const member = previousMember
    ? await reactivateWorkspaceMember(previousMember.id, role)
    : await createWorkspaceMember(workspaceId, userId, role);

  return mapWorkspaceMember(member);
}

/**
 * Updates a workspace member's role
 */
export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
) {
  const member = await findActiveMember(workspaceId, userId);
  if (!member) {
    throw new Error("Member not found");
  }

  // Check if the new role is the same as current role
  if (member.role === newRole) {
    throw new Error("Member already has this role");
  }

  const updatedMember = await updateMemberRole(member.id, newRole);
  return mapWorkspaceMember(updatedMember);
}

/**
 * Removes a member from a workspace
 */
export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
) {
  const member = await findActiveMember(workspaceId, userId);
  if (!member) {
    throw new Error("Member not found");
  }

  await softDeleteMember(member.id);
}

/**
 * Updates a workspace's name, slug, and description
 */
export async function updateWorkspace(
  currentSlug: string,
  userId: string,
  data: UpdateWorkspaceRequest,
): Promise<WorkspaceResponse> {
  // First check if user has access and is authorized to update
  const workspace = await getWorkspaceBySlug(currentSlug, userId);

  if (!workspace) {
    throw new Error("Workspace not found or access denied");
  }

  // Only OWNER and ADMIN can update workspace settings
  if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
    throw new Error("Only workspace owners and admins can update workspace settings");
  }

  // If slug is changing, validate it's available
  if (data.slug !== currentSlug) {
    const slugValidation = validateWorkspaceSlug(data.slug);
    if (!slugValidation.isValid) {
      throw new Error(slugValidation.error!);
    }

    // Check if the new slug already exists
    const existingWorkspace = await db.workspace.findUnique({
      where: { slug: data.slug, deleted: false },
    });
    if (existingWorkspace && existingWorkspace.id !== workspace.id) {
      throw new Error(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    }
  }

  try {
    const updatedWorkspace = await db.workspace.update({
      where: { id: workspace.id },
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        updatedAt: new Date(),
      },
    });

    return {
      ...updatedWorkspace,
      createdAt: updatedWorkspace.createdAt.toISOString(),
      updatedAt: updatedWorkspace.updatedAt.toISOString(),
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
