"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";
import { WorkflowVersionSelector } from "@/components/workflow/WorkflowVersionSelector";
import { useRouter } from "next/navigation";
import { Workflow, Plus, Loader2, Search } from "lucide-react";

export default function WorkflowsPage() {
  const { slug } = useWorkspace();
  const router = useRouter();
  const { workflows, isLoading, error } = useWorkflowNodes(slug, true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const { versions, isLoading: versionsLoading } = useWorkflowVersions(slug, selectedWorkflowId);

  const handleNewWorkflow = () => {
    localStorage.setItem("task_mode", "workflow_editor");
    router.push(`/w/${slug}/task/new`);
  };

  const handleWorkflowClick = (workflowId: number) => {
    if (selectedWorkflowId === workflowId) {
      setSelectedWorkflowId(null);
      setSelectedVersionId(null);
    } else {
      setSelectedWorkflowId(workflowId);
      setSelectedVersionId(null);
    }
  };

  const selectedWorkflow = workflows.find(
    (w) => w.properties.workflow_id === selectedWorkflowId
  );

  // Filter workflows based on search query
  const filteredWorkflows = workflows.filter((workflow) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const workflowName = (workflow.properties.workflow_name || "").toLowerCase();
    const workflowId = workflow.properties.workflow_id.toString();
    return workflowName.includes(query) || workflowId === searchQuery;
  });

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

      <Card className="p-6 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by workflow name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </Card>

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

      {!isLoading && !error && filteredWorkflows.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">
            {workflows.length === 0
              ? "No workflows found"
              : `No workflows match "${searchQuery}"`}
          </p>
        </Card>
      )}

      {!isLoading && !error && filteredWorkflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkflows.map((workflow) => {
            const isSelected = selectedWorkflowId === workflow.properties.workflow_id;
            return (
              <Card
                key={workflow.properties.workflow_id}
                className={`p-6 cursor-pointer transition-colors ${
                  isSelected ? "border-primary" : "hover:border-primary"
                }`}
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
                {isSelected && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <WorkflowVersionSelector
                      workflowName={
                        selectedWorkflow?.properties.workflow_name ||
                        `Workflow ${selectedWorkflowId}`
                      }
                      versions={versions}
                      selectedVersionId={selectedVersionId}
                      onVersionSelect={setSelectedVersionId}
                      isLoading={versionsLoading}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
