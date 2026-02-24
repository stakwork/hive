"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Monitor } from "lucide-react";
import { Artifact, ArtifactType } from "@/lib/chat";
import { CodeArtifactPanel, BrowserArtifactPanel, GraphArtifactPanel, WorkflowArtifactPanel, DiffArtifactPanel } from "../artifacts";
import { PlanArtifactPanel, PlanData } from "@/app/w/[slug]/plan/[featureId]/components/PlanArtifact";
import { TicketsList } from "@/components/features/TicketsList";
import { ArtifactsHeader } from "./ArtifactsHeader";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { FeatureDetail } from "@/types/roadmap";

interface ArtifactsPanelProps {
  artifacts: Artifact[];
  workspaceId?: string;
  taskId?: string;
  podId?: string | null;
  onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
  isMobile?: boolean;
  onTogglePreview?: () => void;
  onStepSelect?: (step: WorkflowTransition) => void;
  planData?: PlanData;
  feature?: FeatureDetail | null;
  featureId?: string;
  onFeatureUpdate?: (feature: FeatureDetail) => void;
}

export function ArtifactsPanel({ artifacts, workspaceId, taskId, podId, onDebugMessage, isMobile = false, onTogglePreview, onStepSelect, planData, feature, featureId, onFeatureUpdate }: ArtifactsPanelProps) {
  const [activeTab, setActiveTab] = useState<ArtifactType | null>(null);

  const handlePlanSave = useCallback(async (updates: Record<string, unknown>) => {
    if (!featureId) return;
    const response = await fetch(`/api/features/${featureId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error("Failed to update feature");
    const result = await response.json();
    if (result.success && onFeatureUpdate) {
      onFeatureUpdate(result.data);
    }
  }, [featureId, onFeatureUpdate]);

  const { saving, saved, savedField, triggerSaved } = useAutoSave({
    data: feature as Record<string, unknown> | null ?? null,
    onSave: handlePlanSave,
  });

  const handleSectionSave = useCallback(async (field: string, value: string) => {
    if (!featureId) return;

    if (field === "user-stories") {
      const story = feature?.userStories?.[0];
      if (story) {
        const res = await fetch(`/api/user-stories/${story.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: value }),
        });
        if (!res.ok) throw new Error("Failed to update user story");
      } else {
        const res = await fetch(`/api/features/${featureId}/user-stories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: value }),
        });
        if (!res.ok) throw new Error("Failed to create user story");
      }

      // Refetch feature to get updated user stories
      const featureRes = await fetch(`/api/features/${featureId}`);
      if (featureRes.ok) {
        const result = await featureRes.json();
        if (result.success && onFeatureUpdate) {
          onFeatureUpdate(result.data);
        }
      }
      triggerSaved("user-stories");
      return;
    }

    // Standard fields: brief, requirements, architecture
    await handlePlanSave({ [field]: value });
    triggerSaved(field);
  }, [featureId, feature, onFeatureUpdate, handlePlanSave, triggerSaved]);

  // Separate artifacts by type
  const codeArtifacts = artifacts.filter((a) => a.type === "CODE");
  const allBrowserArtifacts = artifacts.filter((a) => a.type === "BROWSER");
  const browserArtifacts = allBrowserArtifacts.length > 0 ? [allBrowserArtifacts[allBrowserArtifacts.length - 1]] : [];
  const allIdeArtifacts = artifacts.filter((a) => a.type === "IDE");
  const ideArtifacts = allIdeArtifacts.length > 0 ? [allIdeArtifacts[allIdeArtifacts.length - 1]] : [];
  const graphArtifacts = artifacts.filter((a) => a.type === "GRAPH");
  const workflowArtifacts = artifacts.filter((a) => a.type === "WORKFLOW");
  const diffArtifacts = artifacts.filter((a) => a.type === "DIFF");

  const hasFeature = !!feature && !!featureId && !!onFeatureUpdate;

  const availableTabs: ArtifactType[] = useMemo(() => {
    const tabs: ArtifactType[] = [];
    if (planData) tabs.push("PLAN");
    if (hasFeature) tabs.push("TASKS");
    if (browserArtifacts.length > 0) tabs.push("BROWSER");
    if (workflowArtifacts.length > 0) tabs.push("WORKFLOW");
    if (graphArtifacts.length > 0) tabs.push("GRAPH");
    if (diffArtifacts.length > 0) tabs.push("DIFF");
    if (codeArtifacts.length > 0) tabs.push("CODE");
    if (ideArtifacts.length > 0) tabs.push("IDE");
    return tabs;
  }, [planData, hasFeature, codeArtifacts.length, browserArtifacts.length, ideArtifacts.length, graphArtifacts.length, workflowArtifacts.length, diffArtifacts.length]);

  // Auto-select first tab when artifacts become available
  useEffect(() => {
    if (availableTabs.length > 0 && !activeTab) {
      setActiveTab(availableTabs[0]);
    }
  }, [availableTabs, activeTab]);

  if (availableTabs.length === 0) {
    return null;
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, ease: [0.4, 0.0, 0.2, 1] }}
      className="h-full flex-1 min-w-0 min-h-0 bg-background rounded-xl border shadow-sm overflow-hidden flex flex-col"
    >
      <div className="flex-1 flex flex-col min-h-0">
        {!isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <ArtifactsHeader
              availableArtifacts={availableTabs}
              activeArtifact={activeTab}
              onArtifactChange={setActiveTab}
            />
          </motion.div>
        )}
        {isMobile && onTogglePreview && (
          <motion.div
            className="border-b bg-background/80 backdrop-blur px-3 py-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={onTogglePreview}
              className="gap-2"
            >
              <Monitor className="w-4 h-4" />
              Back to Chat
            </Button>
          </motion.div>
        )}

        <motion.div
          className="flex-1 overflow-hidden min-h-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {planData && (
            <div className="h-full" hidden={activeTab !== "PLAN"}>
              <PlanArtifactPanel
                planData={planData}
                onSectionSave={featureId ? handleSectionSave : undefined}
                savedField={savedField}
                saving={saving}
                saved={saved}
              />
            </div>
          )}
          {hasFeature && (
            <div className="h-full" hidden={activeTab !== "TASKS"}>
              <TicketsList
                featureId={featureId!}
                feature={feature!}
                onUpdate={onFeatureUpdate!}
              />
            </div>
          )}
          {codeArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "CODE"}>
              <CodeArtifactPanel artifacts={codeArtifacts} />
            </div>
          )}
          {browserArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "BROWSER"}>
              <BrowserArtifactPanel
                artifacts={browserArtifacts}
                workspaceId={workspaceId}
                taskId={taskId}
                podId={podId}
                onDebugMessage={onDebugMessage}
                isMobile={isMobile}
              />
            </div>
          )}
          {ideArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "IDE"}>
              <BrowserArtifactPanel
                artifacts={ideArtifacts}
                ide={true}
                workspaceId={workspaceId}
                taskId={taskId}
                podId={podId}
                onDebugMessage={onDebugMessage}
                isMobile={isMobile}
              />
            </div>
          )}
          {graphArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "GRAPH"}>
              <GraphArtifactPanel artifacts={graphArtifacts} />
            </div>
          )}
          {workflowArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "WORKFLOW"}>
              <WorkflowArtifactPanel
                artifacts={workflowArtifacts}
                isActive={activeTab === "WORKFLOW"}
                onStepSelect={onStepSelect}
              />
            </div>
          )}
          {diffArtifacts.length > 0 && (
            <div className="h-full" hidden={activeTab !== "DIFF"}>
              <DiffArtifactPanel artifacts={diffArtifacts} />
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
