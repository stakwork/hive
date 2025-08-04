"use client";

import { useContext } from "react";
import { WorkspaceContext } from "@/contexts/WorkspaceContext";
import type { WorkspaceRole } from "@/types/workspace";

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

  // Permission levels based on workspace roles
  const PERMISSION_LEVELS = {
    READ: [
      "VIEWER",
      "STAKEHOLDER",
      "DEVELOPER",
      "PM",
      "ADMIN",
      "OWNER",
    ] as WorkspaceRole[],
    WRITE: ["DEVELOPER", "PM", "ADMIN", "OWNER"] as WorkspaceRole[],
    ADMIN: ["ADMIN", "OWNER"] as WorkspaceRole[],
    OWNER: ["OWNER"] as WorkspaceRole[],
  };

  // Basic permission checks
  const canRead =
    hasAccess && role ? PERMISSION_LEVELS.READ.includes(role) : false;
  const canWrite =
    hasAccess && role ? PERMISSION_LEVELS.WRITE.includes(role) : false;
  const canAdmin =
    hasAccess && role ? PERMISSION_LEVELS.ADMIN.includes(role) : false;
  const isOwner = hasAccess && role === "OWNER";

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

  // Permission checking utilities
  const checkPermission = (requiredRole: WorkspaceRole) => {
    if (!hasAccess || !role) return false;

    const roleHierarchy: Record<WorkspaceRole, number> = {
      VIEWER: 1,
      STAKEHOLDER: 2,
      DEVELOPER: 3,
      PM: 4,
      ADMIN: 5,
      OWNER: 6,
    };

    return roleHierarchy[role] >= roleHierarchy[requiredRole];
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
