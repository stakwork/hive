"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useParams } from "next/navigation";
import { PlanChatView } from "./components/PlanChatView";

export default function FeatureDetailPage() {
  const { slug: workspaceSlug, id: workspaceId } = useWorkspace();
  const { featureId } = useParams() as { featureId: string };

  return (
    <PlanChatView
      featureId={featureId}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
    />
  );
}
