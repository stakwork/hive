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

  const canRead = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.VIEWER) : false;
  const canWrite = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.DEVELOPER) : false;
  const canAdmin = hasAccess && role ? hasRoleLevel(role, WorkspaceRole.ADMIN) : false;
  const isOwner = hasAccess && role === WorkspaceRole.OWNER;

  const checkPermission = (requiredRole: WorkspaceRole) => {
    if (!hasAccess || !role) return false;
    return hasRoleLevel(role, requiredRole);
  };

  const hasAnyRole = (roles: WorkspaceRole[]) => {
    return hasAccess && role ? roles.includes(role) : false;
  };

  return {
    canRead,
    canWrite,
    canAdmin,
    isOwner,
    hasAccess,
    role,
    checkPermission,
    hasAnyRole,
  };
}
