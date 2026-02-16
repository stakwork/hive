"use client";

import React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useRouter } from "next/navigation";
import { Workflow, Plus, Loader2 } from "lucide-react";

export default function WorkflowsPage() {
  const { slug } = useWorkspace();
  const router = useRouter();
  const { workflows, isLoading, error } = useWorkflowNodes(slug, true);

  const handleNewWorkflow = () => {
    localStorage.setItem("task_mode", "workflow_editor");
    router.push(`/w/${slug}/task/new`);
  };

  const handleWorkflowClick = (workflowId: number) => {
    localStorage.setItem("task_mode", "workflow_editor");
    router.push(`/w/${slug}/task/new`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        icon={Workflow}
        description="Manage and edit Stakwork workflows"
        actions={
          <Button onClick={handleNewWorkflow}>
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      {!isLoading && !error && workflows.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No workflows found</p>
        </Card>
      )}

      {!isLoading && !error && workflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((workflow) => (
            <Card
              key={workflow.properties.workflow_id}
              className="p-6 cursor-pointer hover:border-primary transition-colors"
              onClick={() => handleWorkflowClick(workflow.properties.workflow_id)}
            >
              <div className="flex items-start gap-3">
                <Workflow className="h-5 w-5 text-primary mt-1" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">
                    {workflow.properties.workflow_name || `Workflow ${workflow.properties.workflow_id}`}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    ID: {workflow.properties.workflow_id}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
