"use client";

import { useEffect, useState } from "react";
import { GraphPortal } from "@/components/GraphPortal";
import type { WorkspaceWithRole } from "@/types/workspace";

interface GraphViewProps {
  githubLogin: string;
}

export function GraphView({ githubLogin }: GraphViewProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((res) => res.json())
      .then((data) => setWorkspaces(Array.isArray(data) ? data : []))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, [githubLogin]);

  if (loading) {
    return <div className="h-[calc(100vh-200px)] bg-muted animate-pulse" />;
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-12">
        No workspaces available to visualize.
      </p>
    );
  }

  return (
    <GraphPortal
      workspaces={workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        userRole: ws.userRole,
        memberCount: ws.memberCount,
      }))}
      embedded
    />
  );
}
