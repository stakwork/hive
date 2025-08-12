"use client";

import { useContext } from "react";
import { WorkspaceContext } from "@/contexts/WorkspaceContext";
import { WorkspaceRole, hasRoleLevel } from "@/lib/auth/roles";

/**
 * Hook for access control validation
 * Provides easy access to permission checking functions (canRead, canWrite, canAdmin) for the current workspace
 */
export function useWorkspaceAccess() {
  const context = useContext(WorkspaceContext);

  if (context === undefined) {
    throw new Error(
      "useWorkspaceAccess must be used within a WorkspaceProvider",
    );
  }

  const { role, hasAccess } = context;

  // Basic permission checks using centralized role hierarchy
  const canRead = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.VIEWER) : false;
  const canWrite = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.DEVELOPER) : false;
  const canAdmin = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.ADMIN) : false;
  const isOwner = hasAccess && role === WorkspaceRole.OWNER;

  // Granular permission checks for specific features
  const permissions = {
    // Workspace management
    canManageWorkspace: isOwner,
    canInviteMembers: canAdmin,
    canRemoveMembers: canAdmin,
    canChangeRoles: isOwner,

    // Content permissions
    canViewContent: canRead,
    canCreateContent: canWrite,
    canEditContent: canWrite,
    canDeleteContent: canWrite,

    // Product management
    canManageProducts: canWrite,
    canManageFeatures: canWrite,
    canManageRoadmaps: canWrite,

    // Development permissions
    canManageRepositories: canAdmin,
    canManageSwarms: canAdmin,
    canViewTasks: canRead,
    canAssignTasks: canWrite,
    canManageTasks: canWrite,

    // Analytics and reporting
    canViewAnalytics: canRead,
    canExportData: canWrite,

    // Settings
    canViewSettings: canRead,
    canManageSettings: canAdmin,
  };

  // Permission checking utilities using centralized helpers
  const checkPermission = (requiredRole: WorkspaceRole) => {
    if (!hasAccess || !role) return false;
    return hasRoleLevel(role, requiredRole);
  };

  const requiresRole = (requiredRole: WorkspaceRole) => {
    return checkPermission(requiredRole);
  };

  const hasAnyRole = (roles: WorkspaceRole[]) => {
    return hasAccess && role ? roles.includes(role) : false;
  };

  const hasMinimumRole = (minimumRole: WorkspaceRole) => {
    return checkPermission(minimumRole);
  };

  return {
    // Basic permission flags
    canRead,
    canWrite,
    canAdmin,
    isOwner,
    hasAccess,
    role,

    // Granular permissions object
    permissions,

    // Permission checking utilities
    checkPermission,
    requiresRole,
    hasAnyRole,
    hasMinimumRole,

    // Helper methods for common checks
    canManage: (resource: "workspace" | "members" | "content" | "settings") => {
      switch (resource) {
        case "workspace":
          return permissions.canManageWorkspace;
        case "members":
          return permissions.canInviteMembers;
        case "content":
          return permissions.canEditContent;
        case "settings":
          return permissions.canManageSettings;
        default:
          return false;
      }
    },

    // Access level helpers
    getAccessLevel: () => {
      if (!hasAccess) return "none";
      if (isOwner) return "owner";
      if (canAdmin) return "admin";
      if (canWrite) return "write";
      if (canRead) return "read";
      return "none";
    },

    // Permission summary
    getPermissionSummary: () => ({
      level: role || "none",
      canRead,
      canWrite,
      canAdmin,
      isOwner,
      hasAccess,
    }),
  };
}
