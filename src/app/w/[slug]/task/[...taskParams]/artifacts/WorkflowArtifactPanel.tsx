"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Artifact, WorkflowContent } from "@/lib/chat";
import { useWorkflowPolling } from "@/hooks/useWorkflowPolling";
import WorkflowComponent from "@/components/workflow";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PromptsPanel } from "@/components/prompts";
import { WorkflowChangesPanel } from "./WorkflowChangesPanel";

interface WorkflowArtifactPanelProps {
  artifacts: Artifact[];
  isActive: boolean;
  onStepSelect?: (step: WorkflowTransition) => void;
}

export function WorkflowArtifactPanel({ artifacts, isActive, onStepSelect }: WorkflowArtifactPanelProps) {
  const [clickedStep, setClickedStep] = useState<WorkflowTransition | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDisplayTab, setActiveDisplayTab] = useState<"editor" | "changes" | "prompts" | "stakwork">("editor");

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
  const mergedContent = useMemo(() => {
    let workflowJson: string | undefined;
    let originalWorkflowJson: string | undefined;
    let projectId: string | undefined;
    let workflowId: number | string | undefined;
    let workflowName: string | undefined;
    let workflowRefId: string | undefined;

    // Iterate oldest to newest - later values override earlier ones
    for (const artifact of artifacts) {
      const content = artifact.content as WorkflowContent;
      if (content?.workflowJson) workflowJson = content.workflowJson;
      if (content?.originalWorkflowJson) originalWorkflowJson = content.originalWorkflowJson;
      if (content?.projectId) projectId = content.projectId;
      if (content?.workflowId) workflowId = content.workflowId;
      if (content?.workflowName) workflowName = content.workflowName;
      if (content?.workflowRefId) workflowRefId = content.workflowRefId;
    }

    return { workflowJson, originalWorkflowJson, projectId, workflowId, workflowName, workflowRefId };
  }, [artifacts]);

  const { workflowJson, originalWorkflowJson, projectId, workflowId } = mergedContent;

  // Determine if we're in editor mode (workflowJson present)
  const isEditorMode = !!workflowJson;

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

    // Check if we have changes to show
    const hasChanges = !!(originalWorkflowJson && workflowJson);

    return (
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        {projectId && (
          <Button variant="outline" size="sm" asChild className="mb-2 self-start ml-2 mt-2">
            <Link
              href={`https://jobs.stakwork.com/admin/projects/${projectId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Stakwork
              <ExternalLink className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        )}
        <Tabs
          value={activeDisplayTab}
          onValueChange={(v) => setActiveDisplayTab(v as "editor" | "changes" | "prompts" | "stakwork")}
          className="flex flex-col h-full"
        >
          <TabsList className={`grid w-full flex-shrink-0 ${hasChanges ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="editor">Edit Steps</TabsTrigger>
            {hasChanges && <TabsTrigger value="changes">Changes</TabsTrigger>}
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="stakwork">Stak Run</TabsTrigger>
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
      {projectId && (
        <Button variant="outline" size="sm" asChild className="mb-2 self-start ml-2 mt-2">
          <Link
            href={`https://jobs.stakwork.com/admin/projects/${projectId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Stakwork
            <ExternalLink className="w-4 h-4 ml-1" />
          </Link>
        </Button>
      )}
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
          onStepClick: onStepSelect ? handleStepClick : undefined,
        }}
      />
      <StepDetailsModal
        step={clickedStep}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSelect={handleStepSelectFromModal}
      />
    </div>
  );
}
