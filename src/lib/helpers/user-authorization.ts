import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

/**
 * User Resource Authorization Result
 * Indicates whether a user has access to a specific resource
 */
export interface UserResourceAccessValidation {
  hasAccess: boolean;
  isOwner: boolean;
  canModify: boolean;
  reason?: string;
}

/**
 * Options for user resource validation
 */
interface ValidateUserResourceOptions {
  /**
   * Allow workspace admins to access regardless of ownership
   * Default: true
   */
  allowAdminOverride?: boolean;
  
  /**
   * Workspace role of the requesting user (for admin override)
   */
  workspaceRole?: WorkspaceRole;
}

/**
 * Validates that a user has access to a resource they own
 * 
 * @param resourceOwnerId - The userId who owns the resource (e.g., Task.createdById)
 * @param requestingUserId - The userId making the request
 * @param options - Validation options including admin override
 * @returns UserResourceAccessValidation object
 * 
 * @example
 * ```ts
 * // Basic ownership check
 * const access = validateUserResourceOwnership(task.createdById, session.user.id);
 * if (!access.hasAccess) {
 *   return NextResponse.json({ error: "Access denied" }, { status: 403 });
 * }
 * 
 * // With admin override
 * const access = validateUserResourceOwnership(
 *   task.createdById, 
 *   session.user.id,
 *   { workspaceRole: userRole, allowAdminOverride: true }
 * );
 * ```
 */
export function validateUserResourceOwnership(
  resourceOwnerId: string,
  requestingUserId: string,
  options: ValidateUserResourceOptions = {}
): UserResourceAccessValidation {
  const { allowAdminOverride = true, workspaceRole } = options;

  // Direct ownership check
  const isOwner = resourceOwnerId === requestingUserId;
  if (isOwner) {
    return {
      hasAccess: true,
      isOwner: true,
      canModify: true,
    };
  }

  // Admin override check
  if (allowAdminOverride && workspaceRole) {
    const adminRoles: WorkspaceRole[] = [WorkspaceRole.ADMIN, WorkspaceRole.OWNER];
    const isAdmin = adminRoles.includes(workspaceRole);
    
    if (isAdmin) {
      return {
        hasAccess: true,
        isOwner: false,
        canModify: true,
        reason: "Admin override",
      };
    }
  }

  // Access denied
  return {
    hasAccess: false,
    isOwner: false,
    canModify: false,
    reason: "User does not own this resource",
  };
}

/**
 * Validates user access to their Account record
 * CRITICAL: Always filters by userId to prevent cross-user token access
 * 
 * @param userId - The authenticated user's ID
 * @param accountId - The Account record ID to validate
 * @returns Promise<boolean> - true if account belongs to user
 */
export async function validateAccountOwnership(
  userId: string,
  accountId: string
): Promise<boolean> {
  const account = await db.account.findFirst({
    where: {
      id: accountId,
      userId: userId, // CRITICAL: Always filter by userId
    },
    select: { id: true },
  });

  return !!account;
}

/**
 * Validates user access to their SourceControlToken
 * CRITICAL: Always filters by userId to prevent cross-user token access
 * 
 * @param userId - The authenticated user's ID
 * @param tokenId - The SourceControlToken ID to validate
 * @returns Promise<boolean> - true if token belongs to user
 */
export async function validateSourceControlTokenOwnership(
  userId: string,
  tokenId: string
): Promise<boolean> {
  const token = await db.sourceControlToken.findFirst({
    where: {
      id: tokenId,
      userId: userId, // CRITICAL: Always filter by userId
    },
    select: { id: true },
  });

  return !!token;
}

/**
 * Validates user access to a Task they created
 * 
 * @param taskId - The Task ID to validate
 * @param userId - The authenticated user's ID
 * @param options - Validation options including workspace role
 * @returns Promise<UserResourceAccessValidation>
 * 
 * @example
 * ```ts
 * const access = await validateTaskOwnership(taskId, session.user.id, {
 *   workspaceRole: workspace.userRole,
 *   allowAdminOverride: true
 * });
 * 
 * if (!access.hasAccess) {
 *   return NextResponse.json({ error: access.reason }, { status: 403 });
 * }
 * ```
 */
export async function validateTaskOwnership(
  taskId: string,
  userId: string,
  options: ValidateUserResourceOptions = {}
): Promise<UserResourceAccessValidation> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      createdById: true,
      workspaceId: true,
      workspace: {
        select: {
          id: true,
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!task) {
    return {
      hasAccess: false,
      isOwner: false,
      canModify: false,
      reason: "Task not found",
    };
  }

  // Get user's workspace role if not provided
  // Check if user is workspace owner first (they may not be in members table)
  let workspaceRole = options.workspaceRole;
  if (!workspaceRole) {
    if (task.workspace.ownerId === userId) {
      workspaceRole = WorkspaceRole.OWNER;
    } else {
      workspaceRole = task.workspace.members[0]?.role;
    }
  }

  return validateUserResourceOwnership(task.createdById, userId, {
    ...options,
    workspaceRole,
  });
}

/**
 * Validates user access to a Feature they created
 * 
 * @param featureId - The Feature ID to validate
 * @param userId - The authenticated user's ID
 * @param options - Validation options including workspace role
 * @returns Promise<UserResourceAccessValidation>
 */
export async function validateFeatureOwnership(
  featureId: string,
  userId: string,
  options: ValidateUserResourceOptions = {}
): Promise<UserResourceAccessValidation> {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      id: true,
      createdById: true,
      workspaceId: true,
      workspace: {
        select: {
          id: true,
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!feature) {
    return {
      hasAccess: false,
      isOwner: false,
      canModify: false,
      reason: "Feature not found",
    };
  }

  // Get user's workspace role if not provided
  // Check if user is workspace owner first (they may not be in members table)
  let workspaceRole = options.workspaceRole;
  if (!workspaceRole) {
    if (feature.workspace.ownerId === userId) {
      workspaceRole = WorkspaceRole.OWNER;
    } else {
      workspaceRole = feature.workspace.members[0]?.role;
    }
  }

  return validateUserResourceOwnership(feature.createdById, userId, {
    ...options,
    workspaceRole,
  });
}

/**
 * Helper to extract user ID from session with type safety
 * 
 * @param session - NextAuth session object
 * @returns string | null - userId or null if invalid
 */
export function extractUserId(session: { user?: { id?: string } } | null): string | null {
  if (!session?.user) return null;
  const userId = (session.user as { id?: string })?.id;
  return userId || null;
}