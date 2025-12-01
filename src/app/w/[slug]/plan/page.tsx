"use client";

import { useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FeaturesList } from "@/components/features";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function RoadmapPage() {
  const { id: workspaceId } = useWorkspace();
  const featuresListRef = useRef<{ triggerCreate: () => void }>(null);

  const handleNewFeature = () => {
    featuresListRef.current?.triggerCreate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan"
        actions={
          <Button onClick={handleNewFeature}>
            <Plus className="w-4 h-4 mr-2" />
            New feature
          </Button>
        }
      />

      <FeaturesList ref={featuresListRef} workspaceId={workspaceId} />
    </div>
  );
}
