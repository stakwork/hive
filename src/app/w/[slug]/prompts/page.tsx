"use client";

import React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PromptsPanel } from "@/components/prompts";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FileText } from "lucide-react";

export default function PromptsPage() {
  const { slug } = useWorkspace();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Prompts"
        icon={FileText}
        description="Manage reusable prompts for workflows"
      />
      <PromptsPanel variant="fullpage" workspaceSlug={slug} />
    </div>
  );
}
