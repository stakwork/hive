import { db } from "@/lib/db";
import {
  WorkspaceWithAccess,
  WorkspaceAccessValidation,
  WorkspaceRole,
} from "@/types/workspace";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

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
      hasKey: !!encryptionService.decryptField(
      "stakworkApiKey",
      workspace.stakworkApiKey || "",
    ),
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
    hasKey: !!encryptionService.decryptField(
      "stakworkApiKey",
      workspace.stakworkApiKey || "",
    ),
    isCodeGraphSetup:
      workspace.swarm !== null && workspace.swarm.status === "ACTIVE",
  };
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

