"use client";

import { WorkspaceCard } from "@/components/WorkspaceCard";
import { useWorkspaceLogos } from "@/hooks/useWorkspaceLogos";
import type { WorkspaceWithRole } from "@/types/workspace";

interface WorkspacesListProps {
  workspaces: WorkspaceWithRole[];
}

export function WorkspacesList({ workspaces }: WorkspacesListProps) {
  const { logoUrls } = useWorkspaceLogos(workspaces);

  return (
    <>
      {workspaces.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          workspace={workspace}
          logoUrl={logoUrls[workspace.id]}
        />
      ))}
    </>
  );
}
