import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import type { WorkspaceAuthContext, UserWorkspace } from "@/types/auth";
import { createAuthError } from "./errors";
import { PermissionService } from "./permissions";

/**
 * Service for workspace-level authentication and authorization
 */
export class WorkspaceAuthService {
  private permissionService: PermissionService;

  constructor() {
    this.permissionService = new PermissionService();
  }

  /**
   * Get workspace with user's role and permissions
   */
  public async getWorkspaceContext(
    workspaceIdOrSlug: string,
    userId: string,
    bySlug: boolean = true
  ): Promise<WorkspaceAuthContext | null> {
    const whereClause = bySlug
      ? { slug: workspaceIdOrSlug, deleted: false }
      : { id: workspaceIdOrSlug, deleted: false };

    const workspace = await db.workspace.findFirst({
      where: whereClause,
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!workspace) {
      return null;
    }

    // Check if user is owner
    if (workspace.ownerId === userId) {
      return {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          ownerId: workspace.ownerId,
          owner: workspace.owner,
        },
        userRole: WorkspaceRole.OWNER,
        permissions: this.permissionService.getRolePermissions(WorkspaceRole.OWNER),
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
      return null;
    }

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        ownerId: workspace.ownerId,
        owner: workspace.owner,
      },
      userRole: membership.role as WorkspaceRole,
      permissions: this.permissionService.getRolePermissions(membership.role as WorkspaceRole),
    };
  }

  /**
   * Validate workspace access and return context
   */
  public async validateWorkspaceAccess(
    workspaceSlug: string,
    userId: string,
    minimumRole?: WorkspaceRole
  ): Promise<WorkspaceAuthContext> {
    const context = await this.getWorkspaceContext(workspaceSlug, userId, true);
    
    if (!context) {
      throw createAuthError(
        "WORKSPACE_NOT_FOUND",
        "Workspace not found or access denied"
      );
    }

    if (minimumRole && !this.permissionService.hasMinimumRole(context.userRole, minimumRole)) {
      throw createAuthError(
        "INSUFFICIENT_PERMISSIONS",
        `${minimumRole} role or higher required`
      );
    }

    return context;
  }

  /**
   * Validate workspace access by ID
   */
  public async validateWorkspaceAccessById(
    workspaceId: string,
    userId: string,
    minimumRole?: WorkspaceRole
  ): Promise<WorkspaceAuthContext> {
    const context = await this.getWorkspaceContext(workspaceId, userId, false);
    
    if (!context) {
      throw createAuthError(
        "WORKSPACE_NOT_FOUND",
        "Workspace not found or access denied"
      );
    }

    if (minimumRole && !this.permissionService.hasMinimumRole(context.userRole, minimumRole)) {
      throw createAuthError(
        "INSUFFICIENT_PERMISSIONS",
        `${minimumRole} role or higher required`
      );
    }

    return context;
  }

  /**
   * Check if user has a specific role or higher in a workspace
   */
  public async hasWorkspaceRole(
    workspaceSlug: string,
    userId: string,
    minimumRole: WorkspaceRole
  ): Promise<boolean> {
    try {
      const context = await this.getWorkspaceContext(workspaceSlug, userId, true);
      if (!context) return false;
      return this.permissionService.hasMinimumRole(context.userRole, minimumRole);
    } catch {
      return false;
    }
  }

  /**
   * Get user's workspaces with their roles
   */
  public async getUserWorkspaces(userId: string): Promise<UserWorkspace[]> {
    const workspaces: UserWorkspace[] = [];

    // Get owned workspaces
    const ownedWorkspaces = await db.workspace.findMany({
      where: {
        ownerId: userId,
        deleted: false,
      },
      include: {
        _count: {
          select: { workspaceMembers: true },
        },
      },
    });

    for (const workspace of ownedWorkspaces) {
      workspaces.push({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
        userRole: WorkspaceRole.OWNER,
        memberCount: workspace._count.workspaceMembers + 1,
      });
    }

    // Get member workspaces
    const memberships = await db.workspaceMember.findMany({
      where: {
        userId,
        leftAt: null,
      },
      include: {
        workspace: {
          include: {
            _count: {
              select: { workspaceMembers: true },
            },
          },
        },
      },
    });

    for (const membership of memberships) {
      if (membership.workspace && !membership.workspace.deleted) {
        workspaces.push({
          id: membership.workspace.id,
          name: membership.workspace.name,
          slug: membership.workspace.slug,
          description: membership.workspace.description,
          userRole: membership.role as WorkspaceRole,
          memberCount: membership.workspace._count.workspaceMembers + 1,
        });
      }
    }

    return workspaces.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get user's default workspace
   */
  public async getDefaultWorkspace(userId: string) {
    // Try to get the first owned workspace
    const ownedWorkspace = await db.workspace.findFirst({
      where: {
        ownerId: userId,
        deleted: false,
      },
      orderBy: { createdAt: "asc" },
    });

    if (ownedWorkspace) {
      return ownedWorkspace;
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

    return membership?.workspace || null;
  }
}