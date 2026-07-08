"use client";

import React, { useMemo, useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Artifact, WorkflowContent } from "@/lib/chat";
import { useWorkflowPolling } from "@/hooks/useWorkflowPolling";
import WorkflowComponent from "@/components/workflow";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { PromptsPanel } from "@/components/prompts";
import { ChangesList, type ChangedItem } from "./changes/ChangesList";
import { ProjectInfoCard } from "@/components/ProjectInfoCard";
import { StakworkRunDropdown } from "@/components/StakworkRunDropdown";
import { computeWorkflowDiff } from "@/lib/utils/workflow-diff";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PublishPromptContent, PublishScriptContent } from "@/lib/chat";

interface WorkflowArtifactPanelProps {
  artifacts: Artifact[];
  isActive: boolean;
  onStepSelect?: (step: WorkflowTransition) => void;
  onVersionChange?: (versionId: string) => void;
  isSuperAdmin?: boolean;
  taskId?: string;
}

export function WorkflowArtifactPanel({ artifacts, isActive, onStepSelect, onVersionChange, isSuperAdmin = false }: WorkflowArtifactPanelProps) {
  const { slug } = useWorkspace();
  const [clickedStep, setClickedStep] = useState<WorkflowTransition | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Default to "changes" for prompt/script-only tasks (no workflow), "editor" otherwise.
  // We derive the initial value lazily from the artifacts prop.
  // Note: type may be uppercase ("WORKFLOW") or lowercase ("workflow") depending on context.
  const hasWorkflowArtifact = artifacts.some(
    (a) => String(a.type).toUpperCase() === "WORKFLOW",
  );
  const [activeDisplayTab, setActiveDisplayTab] = useState<"editor" | "changes" | "prompts" | "stakwork" | "children">(
    hasWorkflowArtifact ? "editor" : "changes",
  );
  const handleStepClick = useCallback((step: WorkflowTransition) => {
    setClickedStep(step);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleStepSelectFromModal = useCallback(() => {
    if (clickedStep && onStepSelect) {
      onStepSelect(clickedStep);
    }
    setIsModalOpen(false);
  }, [clickedStep, onStepSelect]);

  // Group artifacts by workflowId for multi-workflow support
  const workflowGroups = useMemo(() => {
    const map = new Map<string, { workflowId: number | string; workflowName: string; artifacts: Artifact[] }>();
    for (const artifact of artifacts) {
      const content = artifact.content as WorkflowContent;
      if (!content?.workflowId) continue;
      const key = String(content.workflowId);
      if (!map.has(key)) {
        map.set(key, {
          workflowId: content.workflowId,
          workflowName: content.workflowName || `Workflow ${key}`,
          artifacts: [],
        });
      }
      map.get(key)!.artifacts.push(artifact);
    }
    return Array.from(map.values());
  }, [artifacts]);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => String(workflowGroups[0]?.workflowId ?? '')
  );

  // Reset to first group when workflowGroups changes (new artifacts arrive)
  useEffect(() => {
    if (workflowGroups.length > 0) {
      setSelectedWorkflowId(String(workflowGroups[0].workflowId));
    }
  }, [workflowGroups]);

  // Scope artifacts to the selected workflow group
  const activeArtifacts = useMemo(() => {
    if (workflowGroups.length <= 1) return artifacts; // backward compat
    return workflowGroups.find(g => String(g.workflowId) === selectedWorkflowId)?.artifacts ?? artifacts;
  }, [workflowGroups, selectedWorkflowId, artifacts]);

  // Check early if there are any relevant artifacts before proceeding.
  // We consider WORKFLOW, PUBLISH_PROMPT, and PUBLISH_SCRIPT as relevant.
  // Note: type may be uppercase or lowercase depending on context (normalize for comparison).
  const hasAnyRelevantArtifacts = artifacts.some((a) => {
    const t = String(a.type).toUpperCase();
    return t === "WORKFLOW" || t === "PUBLISH_PROMPT" || t === "PUBLISH_SCRIPT";
  });

  if (!hasAnyRelevantArtifacts) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No workflow available</div>
      </div>
    );
  }

  // Merge data from all workflow artifacts, always using the LATEST values
  // This supports multiple executions and publishes - always shows the most recent:
  // - workflowJson: Latest published workflow (for Editor tab) — always last-wins
  // - changesWorkflowJson: Only from agent-response artifacts (for Changes tab diff right-side)
  // - originalWorkflowJson: Original workflow before changes (for Changes tab diff left-side)
  // - projectId: Latest execution project (for Stakwork tab)
  // - projectInfo: Project data for project debugger mode
  const mergedContent = useMemo(() => {
    let workflowJson: string | object | undefined;          // Editor tab — always latest winner
    let changesWorkflowJson: string | object | undefined;   // Changes tab — only from agent-response artifacts
    let originalWorkflowJson: string | object | undefined;
    let projectId: string | undefined;
    let workflowId: number | string | undefined;
    let workflowName: string | undefined;
    let workflowRefId: string | undefined;
    let projectInfo: any = undefined;
    let debuggerProjectId: string | undefined;
    let workflowVersionId: string | number | undefined;

    // Iterate oldest to newest - later values override earlier ones
    for (const artifact of activeArtifacts) {
      const content = artifact.content as WorkflowContent;
      if (content?.workflowJson) workflowJson = content.workflowJson;
      // Only update changesWorkflowJson when the artifact has a real originalWorkflowJson
      // (length > 100 distinguishes agent-response artifacts from run-start "" and publish artifacts without originalWorkflowJson)
      const origJsonForGuard =
        typeof content.originalWorkflowJson === "object" && content.originalWorkflowJson !== null
          ? JSON.stringify(content.originalWorkflowJson)
          : (content.originalWorkflowJson ?? "");
      if (
        content?.workflowJson &&
        content?.originalWorkflowJson &&
        origJsonForGuard.length > 100
      ) {
        changesWorkflowJson = content.workflowJson;
      }
      if (content?.originalWorkflowJson) originalWorkflowJson = content.originalWorkflowJson;
      if (content?.projectId) projectId = content.projectId;
      if (content?.workflowId) workflowId = content.workflowId;
      if (content?.workflowName) workflowName = content.workflowName;
      if (content?.workflowRefId) workflowRefId = content.workflowRefId;
      if (content?.projectInfo) projectInfo = content.projectInfo;
      if (content?.debuggerProjectId) debuggerProjectId = content.debuggerProjectId;
      if (content?.workflowVersionId) workflowVersionId = content.workflowVersionId;
    }

    return {
      workflowJson,
      changesWorkflowJson,
      originalWorkflowJson,
      projectId,
      workflowId,
      workflowName,
      workflowRefId,
      projectInfo,
      debuggerProjectId,
      workflowVersionId,
    };
  }, [activeArtifacts]);

  const { workflowJson, changesWorkflowJson, originalWorkflowJson, projectId, workflowId, projectInfo, debuggerProjectId, workflowVersionId } = mergedContent;

  // Detect if we're in project debugger context
  const isProjectDebuggerMode = !!(projectInfo && debuggerProjectId);

  // Determine if we're in editor mode (workflowJson present)
  const isEditorMode = !!workflowJson;

  // Check if we have changes to show (requires both a confirmed agent-response diff and an original)
  const hasChanges = !!(originalWorkflowJson && changesWorkflowJson);

  // Collect PUBLISH_PROMPT and PUBLISH_SCRIPT artifacts from ALL artifacts (not just activeArtifacts)
  // so prompt/script-only tasks are covered even without a workflowId grouping.
  // Normalize type to uppercase for comparison to handle both "PUBLISH_PROMPT" and "publish_prompt".
  const publishPromptArtifacts = useMemo(
    () => artifacts.filter((a) => String(a.type).toUpperCase() === "PUBLISH_PROMPT"),
    [artifacts],
  );
  const publishScriptArtifacts = useMemo(
    () => artifacts.filter((a) => String(a.type).toUpperCase() === "PUBLISH_SCRIPT"),
    [artifacts],
  );

  const hasPublishArtifacts =
    publishPromptArtifacts.length > 0 || publishScriptArtifacts.length > 0;

  // Show Changes tab in editor mode OR whenever there are prompt/script publish artifacts
  const showChangesTab = isEditorMode || hasPublishArtifacts;

  // Build the unified list of changed items for ChangesList
  const changesItems: ChangedItem[] = useMemo(() => {
    const items: ChangedItem[] = [];

    // Workflow diff item (only when we have workflow JSON)
    if (isEditorMode) {
      items.push({
        type: "WORKFLOW",
        name: mergedContent.workflowName || `Workflow ${mergedContent.workflowId ?? ""}`,
        originalJson: originalWorkflowJson || null,
        updatedJson:
          changesWorkflowJson ||
          (!originalWorkflowJson ? workflowJson : null) ||
          null,
      });
    }

    // Prompt items
    for (const artifact of publishPromptArtifacts) {
      const content = artifact.content as PublishPromptContent;
      if (content?.promptId && content?.promptVersionId) {
        items.push({
          type: "PROMPT",
          name: content.promptName || content.promptId,
          promptId: content.promptId,
          promptVersionId: content.promptVersionId,
        });
      }
    }

    // Script items
    for (const artifact of publishScriptArtifacts) {
      const content = artifact.content as PublishScriptContent;
      if (content?.scriptId != null && content?.scriptVersionId != null) {
        items.push({
          type: "SCRIPT",
          name: content.scriptName || String(content.scriptId),
          scriptId: content.scriptId,
          scriptVersionId: content.scriptVersionId,
        });
      }
    }

    return items;
  }, [
    isEditorMode,
    mergedContent.workflowName,
    mergedContent.workflowId,
    originalWorkflowJson,
    changesWorkflowJson,
    workflowJson,
    publishPromptArtifacts,
    publishScriptArtifacts,
  ]);

  // Compute changed step/connection IDs for orange graph highlights (editor tab only)
  const { changedStepIds, changedConnectionIds } = useMemo(() => {
    if (!hasChanges) {
      return { changedStepIds: new Set<string>(), changedConnectionIds: new Set<string>() };
    }
    return computeWorkflowDiff(originalWorkflowJson ?? null, changesWorkflowJson ?? null);
  }, [hasChanges, originalWorkflowJson, changesWorkflowJson]);





  // Parse workflowJson if present (direct mode from graph)
  const parsedWorkflowData = useMemo(() => {
    if (!workflowJson) return null;
    if (typeof workflowJson === "object") return workflowJson as Record<string, unknown>;

    try {
      let data: string | Record<string, unknown> = workflowJson;

      // Remove wrapper quotes from graph API format
      if (typeof data === "string") {
        // Check for \" (backslash-quote) wrapper first
        if (data.startsWith('\\"') && data.endsWith('\\"')) {
          data = data.slice(2, -2);
        }
        // Check for " (single quote) wrapper
        else if (data.startsWith('"') && data.endsWith('"')) {
          data = data.slice(1, -1);
        }
      }

      // Parse until we get an object
      while (typeof data === "string") {
        data = JSON.parse(data);
      }

      return data;
    } catch (e) {
      const preview = typeof workflowJson === "string" ? workflowJson.substring(0, 200) : JSON.stringify(workflowJson)?.substring(0, 200);
      console.error("Failed to parse workflow JSON:", e, "Input:", preview);
      return null;
    }
  }, [workflowJson]);

  // Steps with both attributes.workflow_id and attributes.workflow_name are child workflows
  const childWorkflows = useMemo(() => {
    if (!parsedWorkflowData?.transitions) return [];
    const transitions = Object.values(parsedWorkflowData.transitions) as WorkflowTransition[];
    return transitions
      .filter((t) => t.attributes?.workflow_id && t.attributes?.workflow_name)
      .map((t) => ({
        id: String(t.attributes.workflow_id),
        name: t.attributes.workflow_name as string,
      }));
  }, [parsedWorkflowData]);

  const hasChildWorkflows = childWorkflows.length > 0;

  // Polling hook - in editor mode, only poll when on stakwork tab
  const shouldPoll = isEditorMode
    ? isActive && activeDisplayTab === "stakwork" && !!projectId
    : isActive && !!projectId;

  const {
    workflowData: polledWorkflowData,
    isLoading,
    error,
  } = useWorkflowPolling(shouldPoll && projectId ? projectId : null, shouldPoll, 1000);

  useEffect(() => {
    if (error) {
      console.error("Error fetching workflow data:", error);
    }
  }, [error]);

  // If workflowJson present but failed to parse — error state
  if (isEditorMode && !parsedWorkflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-destructive text-sm">Failed to parse workflow data</div>
      </div>
    );
  }

  // Tabbed UI: enter when in editor mode (workflowJson) OR when prompt/script publish artifacts exist
  if (isEditorMode || hasPublishArtifacts) {
    // Static lookup so Tailwind sees all class names at build time
    const TAB_GRID_COLS: Record<string, string> = {
      "1": "grid-cols-1",
      "2": "grid-cols-2",
      "3": "grid-cols-3",
      "4": "grid-cols-4",
      "5": "grid-cols-5",
    };
    // In editor mode: Editor + Changes (if showChangesTab) + Prompts + Stak Run + optional Children
    // In prompt/script-only mode: only the Changes tab (1 column)
    const colCount = isEditorMode
      ? 3 + (showChangesTab ? 1 : 0) + (hasChildWorkflows ? 1 : 0)
      : 1; // prompt/script-only: just the Changes tab
    const gridColsClass = TAB_GRID_COLS[String(colCount)] ?? "grid-cols-3";

    return (
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        {isSuperAdmin && projectId && (
          <div className="mb-2 self-start ml-2 mt-2">
            <StakworkRunDropdown
              projectId={projectId}
              workflowId={workflowId}
              hiveUrl={`/w/${slug}/projects?id=${projectId}`}
              variant="button"
            />
          </div>
        )}
        {workflowGroups.length > 1 && (
          <div className="px-2 pt-2 pb-1 flex-shrink-0">
            <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue placeholder="Select workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflowGroups.map((g) => (
                  <SelectItem key={String(g.workflowId)} value={String(g.workflowId)}>
                    {g.workflowName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {workflowId && (
          <div className="px-2 pt-1 pb-1 flex-shrink-0 flex items-center gap-2">
            {workflowVersionId && (
              <span
                data-testid="workflow-version-badge"
                className="font-mono text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded"
              >
                v{workflowVersionId}
              </span>
            )}
            <a
              data-testid="workflow-external-link"
              href={
                workflowVersionId
                  ? `https://jobs.stakwork.com/admin/workflows/${workflowId}/edit?version=${workflowVersionId}`
                  : `https://jobs.stakwork.com/admin/workflows/${workflowId}/edit`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Open in Stakwork"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
        <Tabs
          value={activeDisplayTab}
          onValueChange={(v) => setActiveDisplayTab(v as "editor" | "changes" | "prompts" | "stakwork" | "children")}
          className="flex flex-col h-full"
        >
          <TabsList className={`grid w-full flex-shrink-0 ${gridColsClass}`}>
            {isEditorMode && <TabsTrigger value="editor">Edit Steps</TabsTrigger>}
            {showChangesTab && <TabsTrigger value="changes">Changes</TabsTrigger>}
            {isEditorMode && <TabsTrigger value="prompts">Prompts</TabsTrigger>}
            {isEditorMode && <TabsTrigger value="stakwork">Stak Run</TabsTrigger>}
            {isEditorMode && hasChildWorkflows && <TabsTrigger value="children">Child Workflows</TabsTrigger>}
          </TabsList>

          {isEditorMode && (
            <TabsContent value="editor" className="flex-1 overflow-hidden mt-0 relative">
              <WorkflowComponent
                props={{
                  workflowData: parsedWorkflowData!,
                  show_only: true,
                  mode: "workflow",
                  projectId: "",
                  isAdmin: false,
                  workflowId: workflowId?.toString() || "",
                  workflowVersion: workflowVersionId ? String(workflowVersionId) : "",
                  defaultZoomLevel: 0.65,
                  useAssistantDimensions: false,
                  rails_env: process.env.NEXT_PUBLIC_RAILS_ENV || "production",
                  onStepClick: onStepSelect ? handleStepClick : undefined,
                  onVersionChange,
                  changedStepIds,
                  changedConnectionIds,
                }}
              />
              <StepDetailsModal
                step={clickedStep}
                isOpen={isModalOpen}
                onClose={handleModalClose}
                onSelect={handleStepSelectFromModal}
                projectId={projectId}
              />
            </TabsContent>
          )}

          {showChangesTab && (
            <TabsContent value="changes" className="flex-1 overflow-hidden mt-0">
              <ChangesList items={changesItems} />
            </TabsContent>
          )}

          {isEditorMode && hasChildWorkflows && (
            <TabsContent value="children" className="flex-1 overflow-auto mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead className="w-16">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {childWorkflows.map((wf) => (
                    <TableRow key={wf.id}>
                      <TableCell className="font-medium">{wf.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{wf.id}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Open child workflow"
                          onClick={() => window.open(`https://hive.sphinx.chat/w/stakwork/workflows?id=${wf.id}`, "_blank")}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          )}

          {isEditorMode && (
            <TabsContent value="prompts" className="flex-1 overflow-hidden mt-0">
              <PromptsPanel workflowId={typeof workflowId === "number" ? workflowId : undefined} />
            </TabsContent>
          )}

          {isEditorMode && (
            <TabsContent value="stakwork" className="flex-1 overflow-hidden mt-0">
              {!projectId ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="text-muted-foreground text-sm">No workflow execution started yet</div>
                </div>
              ) : isLoading && !polledWorkflowData ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="text-muted-foreground text-sm">Loading workflow...</div>
                </div>
              ) : error && !polledWorkflowData ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="text-destructive text-sm">Error loading workflow: {error}</div>
                </div>
              ) : !polledWorkflowData?.workflowData ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="text-muted-foreground text-sm">Waiting for workflow data...</div>
                </div>
              ) : (
                <WorkflowComponent
                  props={{
                    workflowData: polledWorkflowData.workflowData,
                    show_only: true,
                    mode: "project",
                    projectId: projectId,
                    isAdmin: false,
                    workflowId: "",
                    workflowVersion: "",
                    defaultZoomLevel: 0.65,
                    useAssistantDimensions: false,
                    rails_env: process.env.NEXT_PUBLIC_RAILS_ENV || "production",
                    nodeStyle: "card",
                  }}
                />
              )}
            </TabsContent>
          )}

        </Tabs>
      </div>
    );
  }

  // Non-editor mode: Polling mode with projectId (existing behavior)
  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No project ID available</div>
      </div>
    );
  }

  if (isLoading && !polledWorkflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">Loading workflow...</div>
      </div>
    );
  }

  if (error && !polledWorkflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-destructive text-sm">Error loading workflow: {error}</div>
      </div>
    );
  }

  const workflowData = polledWorkflowData?.workflowData;

  if (!workflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No workflow data available</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <div className="overflow-y-auto flex-1">
        {isSuperAdmin && projectId && (
          <div className="px-4 pt-4">
            <StakworkRunDropdown
              projectId={projectId}
              workflowId={workflowId}
              hiveUrl={`/w/${slug}/projects?id=${projectId}`}
              variant="button"
            />
          </div>
        )}

        {/* Render ProjectInfoCard if in project debugger mode */}
        {isProjectDebuggerMode && projectInfo && (
          <div className="px-4 pt-2">
            <ProjectInfoCard
              projectData={{
                ...projectInfo,
                current_transition_completion: polledWorkflowData?.current_transition_completion,
              }}
            />
          </div>
        )}

        <div className="flex-1">
          <WorkflowComponent
            props={{
              workflowData: workflowData,
              show_only: true,
              mode: "project",
              projectId: projectId,
              isAdmin: false,
              workflowId: "",
              workflowVersion: "",
              defaultZoomLevel: 0.65,
              useAssistantDimensions: false,
              rails_env: process.env.NEXT_PUBLIC_RAILS_ENV || "production",
              onStepClick: isProjectDebuggerMode ? undefined : onStepSelect ? handleStepClick : undefined,
              nodeStyle: "card",
            }}
          />
        </div>
      </div>
      <StepDetailsModal
        step={clickedStep}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSelect={handleStepSelectFromModal}
        projectId={projectId}
      />
    </div>
  );
}
