"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  const { workflows } = useWorkflowNodes(slug, true);

  // Workflow ID input state
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Find matching workflow as user types
  const matchedWorkflow = useMemo(() => {
    if (!workflowIdValue.trim()) return null;
    const searchId = parseInt(workflowIdValue.trim(), 10);
    if (isNaN(searchId)) return null;
    return workflows.find((w) => w.properties.workflow_id === searchId) || null;
  }, [workflowIdValue, workflows]);

  const [debouncedWorkflowId, setDebouncedWorkflowId] = useState<number | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const parsedWorkflowId = useMemo(() => {
    const trimmed = workflowIdValue.trim();
    if (!trimmed) return null;
    const id = parseInt(trimmed, 10);
    return isNaN(id) ? null : id;
  }, [workflowIdValue]);

  // Debounce the workflow ID for API calls
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedWorkflowId(parsedWorkflowId);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [parsedWorkflowId]);

  // Fetch workflow versions when a valid workflow ID is entered (debounced)
  const { versions, isLoading: isLoadingVersions } = useWorkflowVersions(
    slug || null,
    debouncedWorkflowId
  );

  // Reset selected version when workflow ID changes
  useEffect(() => {
    setSelectedVersionId(null);
  }, [debouncedWorkflowId]);

  const handleWorkflowInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkflowIdValue(e.target.value);
  };

  const handleVersionSelect = useCallback((versionId: string) => {
    setSelectedVersionId(versionId);
  }, []);

  const handleSubmit = async () => {
    if (!parsedWorkflowId || !selectedVersionId || !slug) return;

    setIsSubmitting(true);

    try {
      const workflowId = parsedWorkflowId;
      const workflowName = matchedWorkflow?.properties.workflow_name || `Workflow ${workflowId}`;

      const selectedVersion = versions.find(
        (v) => String(v.workflow_version_id) === String(selectedVersionId)
      );

      if (!selectedVersion) {
        throw new Error("Selected version not found");
      }

      const workflowJson = selectedVersion.workflow_json || matchedWorkflow?.properties.workflow_json;
      const workflowRefId = selectedVersion.ref_id;
      const taskTitle = `${workflowName}${selectedVersionId ? ` v${String(selectedVersionId).substring(0, 8)}` : ''}`;

      // Create a new task
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: `Editing workflow ${workflowId}${selectedVersionId ? ` version ${String(selectedVersionId).substring(0, 8)}` : ''}`,
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

  const canSubmit = parsedWorkflowId !== null && selectedVersionId && !isSubmitting;

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
              className="text-lg h-12"
            />
          </div>

          {parsedWorkflowId !== null && (
            <div className="space-y-2">
              {matchedWorkflow && (
                <p className="text-sm text-muted-foreground">
                  Workflow: <span className="font-medium text-foreground">{matchedWorkflow.properties.workflow_name || `Workflow ${matchedWorkflow.properties.workflow_id}`}</span>
                </p>
              )}

              <WorkflowVersionSelector
                workflowName={matchedWorkflow?.properties.workflow_name || `Workflow ${parsedWorkflowId}`}
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
