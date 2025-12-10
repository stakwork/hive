"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PoolLaunchBanner } from "@/components/pool-launch-banner";
import { TasksList } from "@/components/tasks";
import { PageHeader } from "@/components/ui/page-header";

export default function TasksPage() {
  const router = useRouter();
  const { workspace, slug, id: workspaceId } = useWorkspace();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        actions={workspace?.poolState === "COMPLETE" && (
          <Button onClick={() => router.push(`/w/${slug}/task/new`)}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        )}
      />

      {/* Pool Launch Banner - Only show if Pool is not complete */}
      {workspace?.poolState !== "COMPLETE" ? (
        <PoolLaunchBanner
          workspaceSlug={slug}
          title="Complete Pool Setup to Start Managing Tasks"
          description="Launch your development pods to create and manage tasks."
        />
      ) : (
        <TasksList workspaceId={workspaceId} workspaceSlug={slug} />
      )}
    </div>
  );
}
