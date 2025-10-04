"use client";

import type {
  WorkspaceRole,
  WorkspaceWithAccess,
  WorkspaceWithRole,
} from "@/types/workspace";
import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

// Context shape as specified in the requirements
interface WorkspaceContextType {
  // Current workspace data
  workspace: WorkspaceWithAccess | null;
  slug: string;
  id: string;
  role: WorkspaceRole | null;

  // Available workspaces
  workspaces: WorkspaceWithRole[];

  // Task notifications
  waitingForInputCount: number;
  notificationsLoading: boolean;

  // Loading and error states
  loading: boolean;
  error: string | null;

  // Actions
  switchWorkspace: (workspace: WorkspaceWithRole) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshCurrentWorkspace: () => Promise<void>;
  refreshTaskNotifications: () => Promise<void>;
  updateWorkspace: (updates: Partial<WorkspaceWithAccess>) => void;

  // Helper methods
  hasAccess: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined,
);

interface WorkspaceProviderProps {
  children: ReactNode;
  initialSlug?: string; // Allow setting initial workspace from URL or props
}

export function WorkspaceProvider({
  children,
  initialSlug,
}: WorkspaceProviderProps) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  // State management
  const [workspace, setWorkspace] = useState<WorkspaceWithAccess | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  // Always start with loading true to prevent error flash
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Don't persist the loaded slug - start fresh on each mount
  const [currentLoadedSlug, setCurrentLoadedSlug] = useState<string>("");

  // Task notifications state
  const [waitingForInputCount, setWaitingForInputCount] = useState<number>(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  // Fetch user's workspaces
  const fetchWorkspaces = useCallback(async (): Promise<
    WorkspaceWithRole[]
  > => {
    if (status !== "authenticated") return [];

    try {
      const response = await fetch("/api/workspaces");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch workspaces");
      }

      return data.workspaces || [];
    } catch (err) {
      console.error("Failed to fetch workspaces:", err);
      throw err;
    }
  }, [status]);

  // Refresh workspaces list
  const refreshWorkspaces = useCallback(async () => {
    if (status !== "authenticated") return;

    try {
      const fetchedWorkspaces = await fetchWorkspaces();
      setWorkspaces(fetchedWorkspaces);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load workspaces",
      );
    }
  }, [fetchWorkspaces, status]);

  // Fetch task notifications count
  const fetchTaskNotifications = useCallback(async (workspaceSlug: string) => {
    if (!workspaceSlug || status !== "authenticated") return;

    setNotificationsLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/tasks/notifications-count`);
      const data = await response.json();

      if (response.ok && data.success) {
        const count = data.data.waitingForInputCount || 0;
        setWaitingForInputCount(count);

        // Note: Zustand store no longer needed - WorkspaceProvider is the single source of truth
      }
    } catch (err) {
      console.error('Failed to fetch task notifications:', err);
    } finally {
      setNotificationsLoading(false);
    }
  }, [status]);

  // Refresh task notifications
  const refreshTaskNotifications = useCallback(async () => {
    if (workspace?.slug) {
      await fetchTaskNotifications(workspace.slug);
    }
  }, [fetchTaskNotifications, workspace?.slug]);

  // Refresh current workspace - simplified to just re-trigger the effect
  const refreshCurrentWorkspace = useCallback(async () => {
    setCurrentLoadedSlug(""); // Clear the loaded slug to force refetch
  }, []);

  // Update workspace data locally
  const updateWorkspace = useCallback((updates: Partial<WorkspaceWithAccess>) => {
    setWorkspace(current => {
      if (!current) return current;
      return { ...current, ...updates };
    });
  }, []);

  // Switch to a different workspace - SIMPLIFIED to only handle navigation
  const switchWorkspace = useCallback(
    (targetWorkspace: WorkspaceWithRole) => {
      // Update URL to reflect the new workspace
      const currentPath = pathname.replace(/^\/w\/[^\/]+/, "") || "";
      const newPath = `/w/${targetWorkspace.slug}${currentPath}`;

      router.push(newPath);
    },
    [router, pathname],
  );

  // Initialize context when authentication status changes
  useEffect(() => {
    if (status === "authenticated") {
      refreshWorkspaces();
    } else if (status === "unauthenticated") {
      // Reset state when user logs out
      setWorkspace(null);
      setWorkspaces([]);
      setError(null);
      setCurrentLoadedSlug(""); // Reset loaded slug tracking
    }
  }, [status, refreshWorkspaces]);

  // Load current workspace when URL slug changes
  useEffect(() => {
    // Extract slug directly from pathname
    const matches = pathname.match(/^\/w\/([^\/]+)/);
    const currentSlug = matches?.[1] || initialSlug || "";

    // If no slug and authenticated, clear everything
    if (!currentSlug && status === "authenticated") {
      setWorkspace(null);
      setCurrentLoadedSlug("");
      setLoading(false);
      return;
    }

    // If not authenticated yet, just wait
    if (status !== "authenticated") {
      return;
    }

    // Only fetch if we have a slug and haven't loaded it yet
    if (currentSlug && currentSlug !== currentLoadedSlug) {
      const fetchCurrentWorkspace = async () => {
        setLoading(true);
        setError(null);

        try {
          const response = await fetch(`/api/workspaces/${currentSlug}`);
          const data = await response.json();

          if (!response.ok) {
            if (response.status === 404 || response.status === 403) {
              setWorkspace(null);
              setCurrentLoadedSlug(""); // Clear loaded slug on error
              setError("Workspace not found or access denied");
              return;
            }
            throw new Error(data.error || "Failed to fetch workspace");
          }

          setWorkspace(data.workspace);
          setCurrentLoadedSlug(currentSlug); // Track the loaded slug

          // Fetch task notifications for this workspace
          await fetchTaskNotifications(currentSlug);
        } catch (err) {
          console.error(`Failed to fetch workspace ${currentSlug}:`, err);
          setError(
            err instanceof Error ? err.message : "Failed to load workspace",
          );
          setWorkspace(null);
          setCurrentLoadedSlug(""); // Clear loaded slug on error
        } finally {
          setLoading(false);
        }
      };

      fetchCurrentWorkspace();
    }
  }, [pathname, status, initialSlug, currentLoadedSlug]); // Remove workspace from dependencies to prevent loops

  // Refresh notification count when pathname changes (user navigates between pages)
  useEffect(() => {
    if (workspace?.slug && status === "authenticated") {
      fetchTaskNotifications(workspace.slug);
    }
  }, [pathname, workspace?.slug, status, fetchTaskNotifications]);

  // Refresh notification count when window regains focus
  useEffect(() => {
    if (!workspace?.slug || status !== "authenticated") return;

    const handleFocus = () => {
      fetchTaskNotifications(workspace.slug);
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [workspace?.slug, status, fetchTaskNotifications]);

  // Computed values
  const slug = workspace?.slug || "";
  const id = workspace?.id || "";
  const role = workspace?.userRole || null;

  // Consider access granted if:
  // 1. Workspace is loaded, OR
  // 2. We're still loading (don't show error until load completes)
  const hasAccess = !!workspace || loading;

  // Note: Permission checks have been moved to useWorkspaceAccess hook

  const contextValue: WorkspaceContextType = {
    // Current workspace data
    workspace,
    slug,
    id,
    role,

    // Available workspaces
    workspaces,

    // Task notifications
    waitingForInputCount,
    notificationsLoading,

    // Loading and error states
    loading,
    error,

    // Actions
    switchWorkspace,
    refreshWorkspaces,
    refreshCurrentWorkspace,
    refreshTaskNotifications,
    updateWorkspace,

    // Helper methods
    hasAccess,
  };

  return (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// Note: useWorkspace hook has been moved to src/hooks/useWorkspace.ts

// Export the context for advanced usage
export { WorkspaceContext };
