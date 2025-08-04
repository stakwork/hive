"use client";

import { useContext } from "react";
import { WorkspaceContext } from "@/contexts/WorkspaceContext";

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
    workspaces,
    loading,
    error,
    switchWorkspace,
    refreshWorkspaces,
    refreshCurrentWorkspace,
    hasAccess,
  } = context;

  return {
    // Current workspace data
    workspace,
    slug,
    id,
    role,

    // Available workspaces
    workspaces,

    // Loading and error states
    loading,
    error,
    hasAccess,

    // Operations
    switchWorkspace,
    refreshWorkspaces,
    refreshCurrentWorkspace,

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
