"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";
import { TasksList } from "@/components/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { PoolStatusWidget } from "@/components/dashboard/pool-status-widget";

export default function TasksPage() {
  const router = useRouter();
  const { workspace, slug, id: workspaceId } = useWorkspace();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        actions={workspace?.isCodeGraphSetup && (
          <>
            <PoolStatusWidget />
            <Button onClick={() => router.push(`/w/${slug}/task/new`)}>
              <Plus className="w-4 h-4 mr-2" />
              New Task
            </Button>
          </>
        )}
      />

      {/* Connect Repository Card - Only show if CodeGraph is not set up */}
      {workspace && !workspace.isCodeGraphSetup ? (
        <ConnectRepository
          workspaceSlug={slug}
          title="Connect repository to Start Managing Tasks"
          description="Setup your development environment to ask codebase questions or write code."
          buttonText="Connect Repository"
        />
      ) : (
        <TasksList workspaceId={workspaceId} workspaceSlug={slug} />
      )}
    </div>
  );
}
