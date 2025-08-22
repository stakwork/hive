import { WorkspaceRole } from "@prisma/client";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { hasRoleLevel } from "@/lib/auth/roles";
import type { WorkspacePermissions } from "@/types/auth";

/**
 * Service for managing role-based permissions
 */
export class PermissionService {
  /**
   * Get core permissions for a specific role
   * Matches existing validation patterns used throughout the codebase
   */
  public getRolePermissions(role: WorkspaceRole): WorkspacePermissions {
    const roleLevel = WORKSPACE_PERMISSION_LEVELS[role];
    
    return {
      canRead: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER],
      canWrite: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER],
      canAdmin: roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN],
    };
  }

  /**
   * Check if a role meets the minimum required role level
   */
  public hasMinimumRole(userRole: WorkspaceRole, minimumRole: WorkspaceRole): boolean {
    return hasRoleLevel(userRole, minimumRole);
  }

  /**
   * Check if a role has a specific permission
   */
  public hasPermission(
    role: WorkspaceRole,
    permission: keyof WorkspacePermissions
  ): boolean {
    const permissions = this.getRolePermissions(role);
    return permissions[permission];
  }

  /**
   * Get the role hierarchy level
   */
  public getRoleLevel(role: WorkspaceRole): number {
    return WORKSPACE_PERMISSION_LEVELS[role];
  }

  /**
   * Compare two roles
   */
  public compareRoles(role1: WorkspaceRole, role2: WorkspaceRole): number {
    return this.getRoleLevel(role1) - this.getRoleLevel(role2);
  }

  /**
   * Check if a role is an admin role (ADMIN or OWNER)
   */
  public isAdminRole(role: WorkspaceRole): boolean {
    return role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;
  }

  /**
   * Check if a role can manage content (PM or higher)
   */
  public canManageContent(role: WorkspaceRole): boolean {
    return this.hasMinimumRole(role, WorkspaceRole.PM);
  }
}