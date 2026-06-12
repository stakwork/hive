"use client";

import React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ScriptsPanel } from "@/components/scripts";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollText } from "lucide-react";

export default function ScriptsPage() {
  const { slug } = useWorkspace();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Scripts"
        icon={ScrollText}
        description="Manage reusable scripts for workflows"
      />
      <ScriptsPanel variant="fullpage" workspaceSlug={slug} />
    </div>
  );
}
