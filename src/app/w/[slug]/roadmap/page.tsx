"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { FeaturesList } from "@/components/features";
import { PageHeader } from "@/components/ui/page-header";

export default function RoadmapPage() {
  const { id: workspaceId } = useWorkspace();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
      />

      <FeaturesList workspaceId={workspaceId} />
    </div>
  );
}
