"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { FeaturesList } from "@/components/features";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function RoadmapPage() {
  const router = useRouter();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const featuresListRef = useRef<{ triggerCreate: () => void }>(null);
  const conversationalPlan = useFeatureFlag(FEATURE_FLAGS.CONVERSATIONAL_PLAN);

  const handleNewFeature = () => {
    if (conversationalPlan) {
      router.push(`/w/${workspaceSlug}/plan/new`);
    } else {
      featuresListRef.current?.triggerCreate();
    }
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
