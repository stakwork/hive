"use client";

import { Artifact, WorkflowContent } from "@/lib/chat";
import { useWorkflowPolling } from "@/hooks/useWorkflowPolling";
import WorkflowComponent from "@/components/workflow";
import { useEffect } from "react";

interface WorkflowArtifactPanelProps {
  artifacts: Artifact[];
  isActive: boolean;
}

export function WorkflowArtifactPanel({ artifacts, isActive }: WorkflowArtifactPanelProps) {
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

  // Polling hook - only active when tab is active
  const { workflowData, isLoading, error } = useWorkflowPolling(projectId || null, isActive, 1000);

  useEffect(() => {
    if (error) {
      console.error("Error fetching workflow data:", error);
    }
  }, [error]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No project ID available</div>
      </div>
    );
  }

  if (isLoading && !workflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">Loading workflow...</div>
      </div>
    );
  }

  if (error && !workflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-destructive text-sm">Error loading workflow: {error}</div>
      </div>
    );
  }

  if (!workflowData?.workflowData) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No workflow data available</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <WorkflowComponent
        props={{
          workflowData: workflowData.workflowData,
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
    </div>
  );
}
