"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { WorkspaceWithRole } from "@/types/workspace";
import { Building2, ChevronsUpDown, Plus, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { WORKSPACE_LIMITS } from "@/lib/constants";

interface WorkspaceSwitcherProps {
  // Legacy props for backward compatibility
  workspaces?: never; // Mark as deprecated
  activeWorkspace?: never; // Mark as deprecated
  onWorkspaceChange?: (workspace: WorkspaceWithRole) => void; // Optional callback
  refreshTrigger?: number; // Still useful for external refresh triggers
}

export function WorkspaceSwitcher({
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const {
    workspace: activeWorkspace,
    workspaces,
    loading,
    error,
    switchWorkspace,
  } = useWorkspace();
  const router = useRouter();

  // Handle workspace selection with navigation
  const handleWorkspaceSelect = (targetWorkspace: WorkspaceWithRole) => {
    try {
      // Switch workspace context - this already handles navigation
      switchWorkspace(targetWorkspace);

      // Call optional callback for backward compatibility
      onWorkspaceChange?.(targetWorkspace);
    } catch (error) {
      console.error("Failed to switch workspace:", error);
    }
  };

  // Check if user is at workspace limit
  const isAtLimit = workspaces.length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;


  const handleCreateWorkspace = () => {
    if (isAtLimit) {
      // Don't navigate if at limit - this prevents the error flow
      return;
    }

    localStorage.removeItem("repoUrl");
    // Default behavior: navigate to workspace creation
    router.push("/onboarding/workspace");
  };

  // Loading state
  if (loading) {
    return (
      <div className="p-4 border-b">
        <div className="flex items-center gap-3 p-3 border rounded-lg">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <div className="text-left flex-1 space-y-1">
            <Skeleton className="h-4 w-32" />
          </div>
          <ChevronsUpDown className="w-4 h-4 ml-2 opacity-30" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 border-b">
        <div className="flex items-center gap-3 p-3 border rounded-lg border-destructive/20">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-destructive/10">
            <Building2 className="w-4 h-4 text-destructive" />
          </div>
          <div className="text-left flex-1">
            <div className="font-medium text-sm text-destructive">Error</div>
            <div className="text-xs text-muted-foreground">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  // No active workspace (shouldn't happen with context)
  if (!activeWorkspace) {
    return null;
  }

  return (
    <div className="p-4 border-b">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-auto p-3 hover:bg-accent transition-colors"
            disabled={loading}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
                {loading ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Building2 className="w-4 h-4" />
                )}
              </div>
              <div className="text-left">
                <div className="font-medium text-sm">
                  {activeWorkspace.name}
                </div>
              </div>
            </div>
            <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          align="end"
          side="bottom"
          sideOffset={8}
          forceMount
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Workspaces ({workspaces.length})
          </DropdownMenuLabel>

          {/* Current Workspace */}
          <DropdownMenuItem className="flex items-center gap-2 p-2 bg-accent/50">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary text-primary-foreground">
              <Building2 className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">{activeWorkspace.name}</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-primary" />
          </DropdownMenuItem>

          {/* Other Workspaces */}
          {workspaces.filter((ws) => ws.id !== activeWorkspace.id).length >
            0 && (
              <>
                <DropdownMenuSeparator />
                {workspaces
                  .filter((ws) => ws.id !== activeWorkspace.id)
                  .map((workspace, index) => (
                    <DropdownMenuItem
                      key={workspace.id}
                      onClick={() => handleWorkspaceSelect(workspace)}
                      className="flex items-center gap-2 p-2"
                    >
                      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted">
                        <Building2 className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {workspace.name}
                        </div>
                      </div>
                      <DropdownMenuShortcut>⌘{index + 2}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))}
              </>
            )}

          {/* Create New Workspace */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleCreateWorkspace}
            disabled={isAtLimit}
            className={`flex items-center gap-2 p-2 ${
              isAtLimit ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            <div className={`flex items-center justify-center w-6 h-6 rounded-md ${
              isAtLimit ? 'border border-muted bg-muted' : 'border border-dashed'
            }`}>
              {isAtLimit ? (
                <Lock className="w-4 h-4 text-muted-foreground" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1">
              <div className={`font-medium text-sm ${
                isAtLimit ? 'text-muted-foreground' : 'text-muted-foreground'
              }`}>
                {isAtLimit ? 'Workspace limit reached' : 'Create new workspace'}
              </div>
              {isAtLimit && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {workspaces.length}/{WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER} workspaces used
                </div>
              )}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
