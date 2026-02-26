"use client";

import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FeaturesList } from "@/components/features";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function RoadmapPage() {
  const router = useRouter();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();

  const handleNewFeature = () => {
    router.push(`/w/${workspaceSlug}/plan/new`);
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

      <FeaturesList workspaceId={workspaceId} />
    </div>
  );
}
