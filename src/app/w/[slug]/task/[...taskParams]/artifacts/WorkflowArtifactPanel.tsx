"use client";

import { useMemo, useEffect } from "react";
import { Artifact, WorkflowContent } from "@/lib/chat";
import { useWorkflowPolling } from "@/hooks/useWorkflowPolling";
import WorkflowComponent from "@/components/workflow";

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
  const workflowJson = workflowContent?.workflowJson;
  const workflowId = workflowContent?.workflowId;

  // Parse workflowJson if present (direct mode from graph)
  const parsedWorkflowData = useMemo(() => {
    if (!workflowJson) return null;
    try {
      // Try parsing as normal JSON first
      return JSON.parse(workflowJson);
    } catch {
      // If that fails, try converting Ruby hash syntax to JSON
      try {
        let jsonString = workflowJson
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

  // Polling hook - only active when tab is active AND we have projectId (not workflowJson)
  const { workflowData: polledWorkflowData, isLoading, error } = useWorkflowPolling(
    workflowJson ? null : (projectId || null), // Skip polling if we have workflowJson
    isActive,
    1000
  );

  useEffect(() => {
    if (error) {
      console.error("Error fetching workflow data:", error);
    }
  }, [error]);

  // Use parsed workflowJson if available, otherwise use polled data
  const workflowData = parsedWorkflowData || polledWorkflowData?.workflowData;

  // Direct mode: workflowJson provided
  if (workflowJson) {
    if (!parsedWorkflowData) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-destructive text-sm">Failed to parse workflow data</div>
        </div>
      );
    }

    return (
      <div className="h-full w-full flex flex-col overflow-hidden">
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
          }}
        />
      </div>
    );
  }

  // Polling mode: projectId provided
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

  if (!workflowData) {
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
        }}
      />
    </div>
  );
}
