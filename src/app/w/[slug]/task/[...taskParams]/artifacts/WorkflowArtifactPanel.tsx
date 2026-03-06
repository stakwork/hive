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
import { WorkflowChangesPanel } from "./WorkflowChangesPanel";
import { ProjectInfoCard } from "@/components/ProjectInfoCard";
import { StakworkRunDropdown } from "@/components/StakworkRunDropdown";
import { computeWorkflowDiff } from "@/lib/utils/workflow-diff";

interface WorkflowArtifactPanelProps {
  artifacts: Artifact[];
  isActive: boolean;
  onStepSelect?: (step: WorkflowTransition) => void;
  onVersionChange?: (versionId: string) => void;
}

export function WorkflowArtifactPanel({ artifacts, isActive, onStepSelect, onVersionChange }: WorkflowArtifactPanelProps) {
  const { slug } = useWorkspace();
  const [clickedStep, setClickedStep] = useState<WorkflowTransition | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDisplayTab, setActiveDisplayTab] = useState<"editor" | "changes" | "prompts" | "stakwork" | "children">("editor");

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

  if (artifacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No workflow available</div>
      </div>
    );
  }

  // Merge data from all workflow artifacts, always using the LATEST values
  // This supports multiple executions and publishes - always shows the most recent:
  // - workflowJson: Latest published workflow (for Editor tab)
  // - originalWorkflowJson: Original workflow before changes (for Changes tab)
  // - projectId: Latest execution project (for Stakwork tab)
  // - projectInfo: Project data for project debugger mode
  const mergedContent = useMemo(() => {
    let workflowJson: string | undefined;
    let originalWorkflowJson: string | undefined;
    let projectId: string | undefined;
    let workflowId: number | string | undefined;
    let workflowName: string | undefined;
    let workflowRefId: string | undefined;
    let projectInfo: any = undefined;
    let debuggerProjectId: string | undefined;

    // Iterate oldest to newest - later values override earlier ones
    for (const artifact of artifacts) {
      const content = artifact.content as WorkflowContent;
      if (content?.workflowJson) workflowJson = content.workflowJson;
      if (content?.originalWorkflowJson) originalWorkflowJson = content.originalWorkflowJson;
      if (content?.projectId) projectId = content.projectId;
      if (content?.workflowId) workflowId = content.workflowId;
      if (content?.workflowName) workflowName = content.workflowName;
      if (content?.workflowRefId) workflowRefId = content.workflowRefId;
      if (content?.projectInfo) projectInfo = content.projectInfo;
      if (content?.debuggerProjectId) debuggerProjectId = content.debuggerProjectId;
    }

    return {
      workflowJson,
      originalWorkflowJson,
      projectId,
      workflowId,
      workflowName,
      workflowRefId,
      projectInfo,
      debuggerProjectId,
    };
  }, [artifacts]);

  const { workflowJson, originalWorkflowJson, projectId, workflowId, projectInfo, debuggerProjectId } = mergedContent;

  // Detect if we're in project debugger context
  const isProjectDebuggerMode = !!(projectInfo && debuggerProjectId);

  // Determine if we're in editor mode (workflowJson present)
  const isEditorMode = !!workflowJson;

  // Check if we have changes to show
  const hasChanges = !!(originalWorkflowJson && workflowJson);

  // Compute changed step/connection IDs for orange graph highlights (editor tab only)
  const { changedStepIds, changedConnectionIds } = useMemo(() => {
    if (!hasChanges) {
      return { changedStepIds: new Set<string>(), changedConnectionIds: new Set<string>() };
    }
    return computeWorkflowDiff(originalWorkflowJson ?? null, workflowJson ?? null);
  }, [hasChanges, originalWorkflowJson, workflowJson]);

  // Parse workflowJson if present (direct mode from graph)
  const parsedWorkflowData = useMemo(() => {
    if (!workflowJson) return null;
    if (typeof workflowJson === "object") return workflowJson;

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
      console.error("Failed to parse workflow JSON:", e, "Input:", workflowJson?.substring(0, 200));
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

  // Editor mode with tabs
  if (isEditorMode) {
    if (!parsedWorkflowData) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-destructive text-sm">Failed to parse workflow data</div>
        </div>
      );
    }

    // Static lookup so Tailwind sees all class names at build time
    const TAB_GRID_COLS: Record<string, string> = {
      "3": "grid-cols-3",
      "4": "grid-cols-4",
      "5": "grid-cols-5",
    };
    const colCount = 3 + (hasChanges ? 1 : 0) + (hasChildWorkflows ? 1 : 0);
    const gridColsClass = TAB_GRID_COLS[String(colCount)] ?? "grid-cols-3";

    return (
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        {projectId && (
          <div className="mb-2 self-start ml-2 mt-2">
            <StakworkRunDropdown
              projectId={projectId}
              workflowId={workflowId}
              hiveUrl={`/w/${slug}/projects?id=${projectId}`}
              variant="button"
            />
          </div>
        )}
        <Tabs
          value={activeDisplayTab}
          onValueChange={(v) => setActiveDisplayTab(v as "editor" | "changes" | "prompts" | "stakwork" | "children")}
          className="flex flex-col h-full"
        >
          <TabsList className={`grid w-full flex-shrink-0 ${gridColsClass}`}>
            <TabsTrigger value="editor">Edit Steps</TabsTrigger>
            {hasChanges && <TabsTrigger value="changes">Changes</TabsTrigger>}
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="stakwork">Stak Run</TabsTrigger>
            {hasChildWorkflows && <TabsTrigger value="children">Child Workflows</TabsTrigger>}
          </TabsList>

          <TabsContent value="editor" className="flex-1 overflow-hidden mt-0 relative">
            <WorkflowComponent
              props={{
                workflowData: parsedWorkflowData,
                show_only: true,
                mode: "workflow",
                projectId: "",
                isAdmin: false,
                workflowId: workflowId?.toString() || "",
                workflowVersion: "",
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
            />
          </TabsContent>

          {hasChanges && (
            <TabsContent value="changes" className="flex-1 overflow-hidden mt-0">
              <WorkflowChangesPanel
                originalJson={originalWorkflowJson || null}
                updatedJson={workflowJson || null}
              />
            </TabsContent>
          )}

          {hasChildWorkflows && (
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

          <TabsContent value="prompts" className="flex-1 overflow-hidden mt-0">
            <PromptsPanel workflowId={typeof workflowId === "number" ? workflowId : undefined} />
          </TabsContent>

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
                }}
              />
            )}
          </TabsContent>

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
        {projectId && (
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
            }}
          />
        </div>
      </div>
      <StepDetailsModal
        step={clickedStep}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSelect={handleStepSelectFromModal}
      />
    </div>
  );
}
