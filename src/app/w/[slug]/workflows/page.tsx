"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Workflow, ArrowUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";
import { WorkflowVersionSelector } from "@/components/workflow/WorkflowVersionSelector";
import { ArtifactType } from "@prisma/client";

export default function WorkflowsPage() {
  const { slug } = useWorkspace();
  const { workflows, isLoading: isLoadingWorkflows } = useWorkflowNodes(slug, true);
  
  // Workflow ID input state
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const [hasInteractedWithWorkflowInput, setHasInteractedWithWorkflowInput] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Find matching workflow as user types
  const matchedWorkflow = useMemo(() => {
    if (!workflowIdValue.trim()) return null;
    const searchId = parseInt(workflowIdValue.trim(), 10);
    if (isNaN(searchId)) return null;
    return workflows.find((w) => w.properties.workflow_id === searchId) || null;
  }, [workflowIdValue, workflows]);

  const hasValidWorkflowId = workflowIdValue.trim().length > 0 && !isNaN(parseInt(workflowIdValue.trim(), 10));
  const workflowNotFound = hasValidWorkflowId && !matchedWorkflow && !isLoadingWorkflows && workflows.length > 0 && hasInteractedWithWorkflowInput;

  // Fetch workflow versions when a workflow is matched
  const workflowIdForVersions = matchedWorkflow ? matchedWorkflow.properties.workflow_id : null;
  const { versions, isLoading: isLoadingVersions } = useWorkflowVersions(
    slug || null,
    workflowIdForVersions
  );

  // Reset selected version when workflow changes
  useEffect(() => {
    setSelectedVersionId(null);
  }, [workflowIdForVersions]);

  const handleWorkflowInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkflowIdValue(e.target.value);
    setHasInteractedWithWorkflowInput(true);
  };

  const handleWorkflowInputBlur = () => {
    setHasInteractedWithWorkflowInput(true);
  };

  const handleVersionSelect = useCallback((versionId: string) => {
    setSelectedVersionId(versionId);
  }, []);

  const handleSubmit = async () => {
    if (!matchedWorkflow || !selectedVersionId || !slug) return;

    setIsSubmitting(true);

    try {
      const workflowId = matchedWorkflow.properties.workflow_id;
      const workflowName = matchedWorkflow.properties.workflow_name || `Workflow ${workflowId}`;

      // Fetch the specific workflow version
      const versionResponse = await fetch(
        `/api/workspaces/${slug}/workflows/${workflowId}/versions`
      );
      
      if (!versionResponse.ok) {
        throw new Error("Failed to fetch workflow versions");
      }

      const versionsData = await versionResponse.json();
      const selectedVersion = versionsData.find(
        (v: any) => v.workflow_version_id === selectedVersionId
      );

      if (!selectedVersion) {
        throw new Error("Selected version not found");
      }

      const workflowJson = selectedVersion.workflow_json || matchedWorkflow.properties.workflow_json;
      const workflowRefId = selectedVersion.ref_id;
      const taskTitle = `${workflowName}${selectedVersionId ? ` v${selectedVersionId.substring(0, 8)}` : ''}`;

      // Create a new task
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: `Editing workflow ${workflowId}${selectedVersionId ? ` version ${selectedVersionId.substring(0, 8)}` : ''}`,
          status: "active",
          workspaceSlug: slug,
          mode: "workflow_editor",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;

      // Save workflow artifact to database
      const saveResponse = await fetch(`/api/tasks/${newTaskId}/messages/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Loaded: ${taskTitle}\nSelect a step on the right as a starting point.`,
          role: "ASSISTANT",
          artifacts: [
            {
              type: ArtifactType.WORKFLOW,
              content: {
                workflowJson: workflowJson,
                workflowId: workflowId,
                workflowName: workflowName,
                workflowRefId: workflowRefId,
                workflowVersionId: selectedVersionId,
              },
            },
          ],
        }),
      });

      if (!saveResponse.ok) {
        console.error("Failed to save workflow artifact:", await saveResponse.text());
      }

      // Navigate to task chat view
      window.location.href = `/w/${slug}/task/${newTaskId}`;
    } catch (error) {
      console.error("Failed to create workflow task:", error);
      setIsSubmitting(false);
    }
  };

  const canSubmit = matchedWorkflow && selectedVersionId && !isSubmitting;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        icon={Workflow}
        description="Manage and edit Stakwork workflows"
      />

      <Card className="p-6 max-w-2xl">
        <div className="space-y-4">
          <div className="relative">
            <Input
              type="text"
              placeholder="Enter workflow ID..."
              value={workflowIdValue}
              onChange={handleWorkflowInputChange}
              onBlur={handleWorkflowInputBlur}
              className="text-lg h-12"
            />
          </div>

          {workflowNotFound && (
            <p className="text-sm text-destructive">
              Workflow ID not found
            </p>
          )}

          {matchedWorkflow && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Workflow: <span className="font-medium text-foreground">{matchedWorkflow.properties.workflow_name || `Workflow ${matchedWorkflow.properties.workflow_id}`}</span>
              </p>

              <WorkflowVersionSelector
                workflowName={matchedWorkflow.properties.workflow_name || `Workflow ${matchedWorkflow.properties.workflow_id}`}
                versions={versions}
                selectedVersionId={selectedVersionId}
                onVersionSelect={handleVersionSelect}
                isLoading={isLoadingVersions}
              />

              {canSubmit && (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full mt-4"
                >
                  <ArrowUp className="w-4 h-4 mr-2" />
                  Load Workflow
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
