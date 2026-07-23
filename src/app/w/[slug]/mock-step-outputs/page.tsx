"use client";

import React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { MockStepOutputsPanel } from "@/components/mock-step-outputs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollText } from "lucide-react";

export default function MockStepOutputsPage() {
  const { slug } = useWorkspace();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Mock Step Outputs"
        icon={ScrollText}
        description="Manage mock outputs for workflow steps"
      />
      <MockStepOutputsPanel variant="fullpage" workspaceSlug={slug} />
    </div>
  );
}
