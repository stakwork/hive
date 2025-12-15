"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { Artifact, WorkflowContent } from "@/lib/chat";
import { useWorkflowPolling } from "@/hooks/useWorkflowPolling";
import WorkflowComponent from "@/components/workflow";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import { SelectedStepContent, createSelectedStep } from "@/lib/workflow-step";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface WorkflowArtifactPanelProps {
  artifacts: Artifact[];
  isActive: boolean;
  onStepSelect?: (step: SelectedStepContent) => void;
}

export function WorkflowArtifactPanel({ artifacts, isActive, onStepSelect }: WorkflowArtifactPanelProps) {
  const [clickedStep, setClickedStep] = useState<SelectedStepContent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDisplayTab, setActiveDisplayTab] = useState<"editor" | "stakwork">("editor");

  const handleStepClick = useCallback((step: WorkflowTransition) => {
    const selectedStep = createSelectedStep(step);
    setClickedStep(selectedStep);
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

  // Show the most recent workflow artifact
  const latestArtifact = artifacts[artifacts.length - 1];
  const workflowContent = latestArtifact.content as WorkflowContent;
  const projectId = workflowContent?.projectId;
  const workflowJson = workflowContent?.workflowJson;
  const workflowId = workflowContent?.workflowId;

  // Determine if we're in editor mode (workflowJson present)
  const isEditorMode = !!workflowJson;

  // Parse workflowJson if present (direct mode from graph)
  const parsedWorkflowData = useMemo(() => {
    if (!workflowJson) return null;
    try {
      // Try parsing as normal JSON first
      return JSON.parse(workflowJson);
    } catch {
      // If that fails, try converting Ruby hash syntax to JSON
      try {
        const jsonString = workflowJson
          .replace(/=>/g, ':')           // Ruby hash rockets
          .replace(/:nil/g, ':null')     // Ruby nil to JSON null
          .replace(/\bnil\b/g, 'null');  // standalone nil
        return JSON.parse(jsonString);
      } catch (e) {
        console.error("Failed to parse workflow JSON:", e, "Input:", workflowJson?.substring(0, 200));
        return null;
      }
    }
  }, [workflowJson]);

  // Polling hook - in editor mode, only poll when on stakwork tab
  const shouldPoll = isEditorMode
    ? (isActive && activeDisplayTab === "stakwork" && !!projectId)
    : (isActive && !!projectId);

  const { workflowData: polledWorkflowData, isLoading, error } = useWorkflowPolling(
    shouldPoll && projectId ? projectId : null,
    shouldPoll,
    1000
  );

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

    return (
      <div className="h-full w-full flex flex-col overflow-hidden relative">
        <Tabs
          value={activeDisplayTab}
          onValueChange={(v) => setActiveDisplayTab(v as "editor" | "stakwork")}
          className="flex flex-col h-full"
        >
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="stakwork">Stakwork</TabsTrigger>
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
