"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { Share2 } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { PageHeader } from "@/components/ui/page-header";
import { GraphExplorer } from "@/components/graph-explorer/GraphExplorer";

export default function GraphExplorerPage() {
  const { slug } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const searchParams = useSearchParams();
  // Deep link from anywhere that knows a ref_id (e.g. agent-session concept
  // chips) — open the explorer focused on that node.
  const initialRefId = searchParams.get("ref_id");

  if (!canAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Share2 className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground max-w-sm">
          The Graph Explorer is only available to workspace Admins and Owners.
        </p>
      </div>
    );
  }

  if (!slug) return null;

  return (
    <div className="flex flex-col h-full p-6">
      <PageHeader
        icon={Share2}
        title="Graph Explorer"
        description="Run read-only Cypher queries against the workspace graph database."
      />
      <GraphExplorer workspaceSlug={slug} initialRefId={initialRefId} />
    </div>
  );
}
