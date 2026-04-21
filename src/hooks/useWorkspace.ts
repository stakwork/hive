"use client";

import { WorkspaceContext } from "@/contexts/WorkspaceContext";
import { useContext } from "react";

/**
 * Hook for workspace operations
 * Encapsulates workspace CRUD operations, switching between workspaces, and loading states
 */
export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  const {
    workspace,
    slug,
    id,
    role,
    isSuperAdmin,
    workspaces,
    waitingForInputCount,
    notificationsLoading,
    loading,
    error,
    switchWorkspace,
    refreshWorkspaces,
    refreshCurrentWorkspace,
    refreshTaskNotifications,
    updateWorkspace,
    hasAccess,
    isPublicViewer,
  } = context;

  return {
    // Current workspace data
    workspace,
    slug,
    id,
    role,
    isSuperAdmin,

    // Available workspaces
    workspaces,

    // Task notifications
    waitingForInputCount,
    notificationsLoading,

    // Loading and error states
    loading,
    error,
    hasAccess,
    isPublicViewer,

    // Operations
    switchWorkspace,
    refreshWorkspaces,
    refreshCurrentWorkspace,
    refreshTaskNotifications,
    updateWorkspace,

    // Helper methods
    isOwner: role === "OWNER",
    isAdmin: role === "ADMIN",
    isPM: role === "PM",
    isDeveloper: role === "DEVELOPER",
    isStakeholder: role === "STAKEHOLDER",
    isViewer: role === "VIEWER",

    // Workspace utilities
    getWorkspaceById: (workspaceId: string) =>
      workspaces.find((ws) => ws.id === workspaceId),
    getWorkspaceBySlug: (workspaceSlug: string) =>
      workspaces.find((ws) => ws.slug === workspaceSlug),
    isCurrentWorkspace: (workspaceId: string) => id === workspaceId,
  };
}
