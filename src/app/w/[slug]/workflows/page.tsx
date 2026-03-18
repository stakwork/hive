"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Workflow, ArrowUp, Bug, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";
import { useRecentWorkflows } from "@/hooks/useRecentWorkflows";
import { WorkflowVersionSelector } from "@/components/workflow/WorkflowVersionSelector";
import { ArtifactType } from "@prisma/client";

export default function WorkflowsPage() {
  const { slug } = useWorkspace();
  const searchParams = useSearchParams();
  const { workflows } = useWorkflowNodes(slug, true);
  const {
    workflows: recentWorkflows,
    isLoading: isLoadingRecent,
    error: recentError,
  } = useRecentWorkflows();

  // Workflow ID input state
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Run detection state
  const [runData, setRunData] = useState<{ id: number; name: string; workflow_id: number } | null>(null);
  const [isResolvingRun, setIsResolvingRun] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);

  // Find matching workflow as user types
  const matchedWorkflow = useMemo(() => {
    if (!workflowIdValue.trim()) return null;
    const searchId = parseInt(workflowIdValue.trim(), 10);
    if (isNaN(searchId)) return null;
    return workflows.find((w) => w.properties.workflow_id === searchId) || null;
  }, [workflowIdValue, workflows]);

  // Pre-fill from ?id= URL parameter on mount
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) setWorkflowIdValue(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Parallel run resolution — check if ID is a Run/Project
  useEffect(() => {
    if (debouncedWorkflowId === null) {
      setRunData(null);
      return;
    }
    setIsResolvingRun(true);
    fetch(`/api/stakwork/projects/${debouncedWorkflowId}`)
      .then((r) => r.json())
      .then((data) => setRunData(data.success ? data.data.project : null))
      .catch(() => setRunData(null))
      .finally(() => setIsResolvingRun(false));
  }, [debouncedWorkflowId]);

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

  const handleRecentWorkflowClick = useCallback((id: number) => {
    setWorkflowIdValue(String(id));
    // Focus the input so the user can see the autofilled value
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
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

  const handleDebugRun = async () => {
    if (!runData || !slug) return;
    setIsDebugging(true);
    try {
      // 1. Fetch latest version for the run's associated workflow
      const versionsRes = await fetch(`/api/workspaces/${slug}/workflows/${runData.workflow_id}/versions`);
      const versionsData = await versionsRes.json();
      const latestVersion = versionsData.data?.versions?.[0]; // API returns newest-first
      if (!latestVersion) throw new Error('No versions found for workflow');

      const workflowId = runData.workflow_id;
      const workflowName = latestVersion.workflow_name || `Workflow ${workflowId}`;
      const workflowRefId = latestVersion.ref_id;
      const workflowJson = latestVersion.workflow_json;
      const workflowVersionId = String(latestVersion.workflow_version_id);
      const taskTitle = `Debug run ${runData.id}`;

      // 2. Create workflow_editor task
      const taskRes = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskTitle, description: taskTitle, status: 'active', workspaceSlug: slug, mode: 'workflow_editor' }),
      });
      if (!taskRes.ok) throw new Error('Failed to create task');
      const { data: { id: newTaskId } } = await taskRes.json();

      // 3. Save ASSISTANT workflow artifact
      await fetch(`/api/tasks/${newTaskId}/messages/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Loaded: ${workflowName}\nSelect a step on the right as a starting point.`,
          role: 'ASSISTANT',
          artifacts: [{ type: ArtifactType.WORKFLOW, content: { workflowJson, workflowId, workflowName, workflowRefId, workflowVersionId } }],
        }),
      });

      // 4. Auto-send "Debug this run [runId]" — triggers the AI workflow
      await fetch('/api/workflow-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: newTaskId, message: `Debug this run ${runData.id}`, workflowId, workflowName, workflowRefId, workflowVersionId }),
      });

      // 5. Navigate to task
      window.location.href = `/w/${slug}/task/${newTaskId}`;
    } catch (err) {
      console.error('Failed to debug run:', err);
      setIsDebugging(false);
    }
  };

  const isRun = runData !== null;
  const isWorkflow = versions.length > 0;
  const isLoading = isResolvingRun || isLoadingVersions;

  const showEmptyState = !isLoadingRecent && (recentError !== null || recentWorkflows.length === 0);

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
              ref={inputRef}
              type="text"
              placeholder="Enter workflow or run ID..."
              value={workflowIdValue}
              onChange={handleWorkflowInputChange}
              className="text-lg h-12"
            />
          </div>

          {parsedWorkflowId !== null && (
            <div className="space-y-2">
              {matchedWorkflow && (
                <p className="text-sm text-muted-foreground">
                  Workflow:{" "}
                  <span className="font-medium text-foreground">
                    {matchedWorkflow.properties.workflow_name ||
                      `Workflow ${matchedWorkflow.properties.workflow_id}`}
                  </span>
                </p>
              )}

              <WorkflowVersionSelector
                workflowName={
                  matchedWorkflow?.properties.workflow_name || `Workflow ${parsedWorkflowId}`
                }
                versions={versions}
                selectedVersionId={selectedVersionId}
                onVersionSelect={handleVersionSelect}
                isLoading={isLoadingVersions}
              />

              {/* Loading indicator while resolving run or versions */}
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking ID...</span>
                </div>
              )}

              {/* Action buttons — shown once resolution is complete */}
              {!isLoading && (isRun || (isWorkflow && selectedVersionId)) && (
                <div className="flex gap-2 mt-4">
                  {isRun && (
                    <Button
                      onClick={handleDebugRun}
                      disabled={isDebugging || isSubmitting}
                      variant="default"
                      className="flex-1"
                    >
                      {isDebugging ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Bug className="w-4 h-4 mr-2" />
                      )}
                      Debug this run
                    </Button>
                  )}
                  {isWorkflow && selectedVersionId && (
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting || isDebugging}
                      variant={isRun ? "outline" : "default"}
                      className="flex-1"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowUp className="w-4 h-4 mr-2" />
                      )}
                      Load Workflow
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Recent Workflows Section */}
      <div className="max-w-2xl space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Workflows</h2>

        {isLoadingRecent && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}

        {showEmptyState && (
          <p className="text-sm text-muted-foreground">No recent workflows found</p>
        )}

        {!isLoadingRecent && recentWorkflows.length > 0 && (
          <div className="space-y-1">
            {recentWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => handleRecentWorkflowClick(workflow.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-left hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
              >
                <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">
                  #{workflow.id}
                </span>
                <span className="text-sm text-foreground truncate">{workflow.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
