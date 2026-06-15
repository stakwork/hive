"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Workflow, Bug, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useRecentWorkflows } from "@/hooks/useRecentWorkflows";
import { ArtifactType } from "@/lib/chat";

const formatDate = (dateString: string) => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateString;
  }
};

export default function WorkflowsPage() {
  const { slug } = useWorkspace();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { workflows } = useWorkflowNodes(slug, true);
  const {
    workflows: recentWorkflows,
    isLoading: isLoadingRecent,
    error: recentError,
  } = useRecentWorkflows();

  // Workflow ID input state
  const [workflowIdValue, setWorkflowIdValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Run detection state
  const [runData, setRunData] = useState<{ id: number; name: string; workflow_id: number; created_at: string } | null>(null);
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

  const handleWorkflowInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkflowIdValue(e.target.value);
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

      // 3b. Dual-write WorkflowTask row
      await fetch(`/api/tasks/${newTaskId}/workflow-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, workflowName, workflowRefId, workflowVersionId }),
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
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const isRecentRun = isRun && (Date.now() - new Date(runData!.created_at).getTime()) < ONE_YEAR_MS;
  const isWorkflow = matchedWorkflow !== null;
  const isLoading = isResolvingRun;

  const neitherFound = !isLoading && parsedWorkflowId !== null && !isRun && !isWorkflow;
  const bothFound    = !isLoading && parsedWorkflowId !== null && isRecentRun && isWorkflow;

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

              {/* Loading indicator while resolving run */}
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking ID...</span>
                </div>
              )}

              {/* State: Neither found */}
              {neitherFound && (
                <p className="text-sm text-muted-foreground py-2">
                  No project or workflow has been found.
                </p>
              )}

              {/* State: Both found — disambiguation prompt + two outline buttons */}
              {bothFound && (
                <div className="space-y-3 mt-4">
                  <p className="text-sm text-muted-foreground">
                    We&apos;ve found both a Run and a Workflow with that ID — what would you like to do?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleDebugRun}
                      disabled={isDebugging}
                      variant="outline"
                      className="flex-1"
                    >
                      {isDebugging ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Bug className="w-4 h-4 mr-2" />
                      )}
                      Debug this run
                    </Button>
                    <Button
                      onClick={() => slug && router.push(`/w/${slug}/workflows/${parsedWorkflowId}`)}
                      disabled={isDebugging}
                      variant="outline"
                      className="flex-1"
                    >
                      Inspect Workflow
                    </Button>
                  </div>
                </div>
              )}

              {/* State: Only one found — single default button */}
              {!isLoading && !bothFound && (isRecentRun || isWorkflow) && (
                <div className="flex gap-2 mt-4">
                  {isRecentRun && (
                    <Button
                      onClick={handleDebugRun}
                      disabled={isDebugging}
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
                  {isWorkflow && !isRecentRun && (
                    <Button
                      onClick={() => slug && router.push(`/w/${slug}/workflows/${parsedWorkflowId}`)}
                      variant="default"
                      className="flex-1"
                    >
                      Inspect Workflow →
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Recently Modified Section */}
      <div className="max-w-2xl space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recently Modified</h2>

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
                onClick={() => slug && router.push(`/w/${slug}/workflows/${workflow.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-left hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
              >
                <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">
                  #{workflow.id}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-foreground truncate">{workflow.name}</span>
                  {(workflow.updated_at || workflow.last_modified_by) && (
                    <span className="text-xs text-muted-foreground truncate">
                      {workflow.updated_at && formatDate(workflow.updated_at)}
                      {workflow.updated_at && workflow.last_modified_by && " · "}
                      {workflow.last_modified_by}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
