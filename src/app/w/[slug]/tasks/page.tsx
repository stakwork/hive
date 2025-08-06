"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";
import { TasksList } from "@/components/tasks";

export default function TasksPage() {
  const router = useRouter();
  const { workspace, slug, id: workspaceId } = useWorkspace();
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Tasks</h1>
          <p className="text-muted-foreground mt-2">
            Manage and track your development tasks and issues.
          </p>
        </div>
        {workspace?.isCodeGraphSetup && (
          <Button onClick={() => router.push(`/w/${slug}/task/new`)}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        )}
      </div>

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
