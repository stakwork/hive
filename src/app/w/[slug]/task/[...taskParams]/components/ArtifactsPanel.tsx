"use client";

import { useMemo, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Monitor, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Artifact, ArtifactType } from "@/lib/chat";
import { CodeArtifactPanel, BrowserArtifactPanel, GraphArtifactPanel, WorkflowArtifactPanel, DiffArtifactPanel } from "../artifacts";
import { PlanArtifactPanel, PlanData, SectionHighlights } from "@/app/w/[slug]/plan/[featureId]/components/PlanArtifact";
import { CompactTasksList } from "@/components/features/CompactTasksList";
import { ArtifactsHeader } from "./ArtifactsHeader";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";
import type { FeatureDetail } from "@/types/roadmap";

const VALID_PLAN_TABS: ArtifactType[] = ["PLAN", "TASKS"];

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
  controlledTab?: ArtifactType | null;
  onControlledTabChange?: (tab: ArtifactType) => void;
  sectionHighlights?: SectionHighlights | null;
}

export function ArtifactsPanel({
  artifacts,
  workspaceId,
  taskId,
  podId,
  onDebugMessage,
  isMobile = false,
  onTogglePreview,
  onStepSelect,
  planData,
  feature,
  featureId,
  onFeatureUpdate,
  controlledTab,
  onControlledTabChange,
  sectionHighlights,
}: ArtifactsPanelProps) {
  const [internalTab, setInternalTab] = useState<ArtifactType | null>(null);
  
  // Support controlled mode (plan) and uncontrolled mode (task)
  const isControlled = controlledTab !== undefined;
  const activeTab = isControlled ? controlledTab : internalTab;
  const setActiveTab = isControlled && onControlledTabChange ? onControlledTabChange : setInternalTab;
  const [isApiCalling, setIsApiCalling] = useState(false);
  const [hasInitiatedGeneration, setHasInitiatedGeneration] = useState(false);
  const toastedRunIdRef = useRef<string | null>(null);

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
    data: (feature as Record<string, unknown>) ?? null,
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
  const hasTasks = !!(feature?.phases?.[0]?.tasks && feature.phases[0].tasks.length > 0);
  const hasArchitecture = !!feature?.architecture;

  const { latestRun, refetch: refetchRun } = useStakworkGeneration({
    featureId: featureId || "",
    type: "TASK_GENERATION",
    enabled: hasFeature,
  });

  const isRunInProgress = latestRun?.status === "IN_PROGRESS" || latestRun?.status === "PENDING";
  const isRunFailed = latestRun?.status === "FAILED" || latestRun?.status === "ERROR" || latestRun?.status === "HALTED";
  const isGenerating = isApiCalling || isRunInProgress;
  const showTasksTab = hasTasks || isGenerating || hasInitiatedGeneration;

  // Clear the API-calling flag once the run status has taken over
  useEffect(() => {
    if (isApiCalling && isRunInProgress) {
      setIsApiCalling(false);
    }
  }, [isApiCalling, isRunInProgress]);

  // Reset the initiated generation flag when generation is definitively done
  useEffect(() => {
    if (hasTasks || isRunFailed) {
      setHasInitiatedGeneration(false);
    }
  }, [hasTasks, isRunFailed]);

  // Fire toast notification once per failed run
  useEffect(() => {
    if (
      isRunFailed &&
      latestRun?.id &&
      toastedRunIdRef.current !== latestRun.id
    ) {
      toastedRunIdRef.current = latestRun.id;
      toast.error("Task generation failed", {
        description: "Something went wrong. Click Retry to try again.",
      });
    }
  }, [isRunFailed, latestRun?.id]);

  const handleGenerateTasks = useCallback(async () => {
    if (!featureId || !workspaceId || isGenerating) return;

    setIsApiCalling(true);
    setHasInitiatedGeneration(true);
    
    // Switch to TASKS tab in both controlled and uncontrolled modes
    if (isControlled && onControlledTabChange) {
      onControlledTabChange("TASKS");
    } else {
      setInternalTab("TASKS");
    }

    try {
      const response = await fetch("/api/stakwork/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "TASK_GENERATION",
          featureId,
          workspaceId,
          autoAccept: true,
          params: { skipClarifyingQuestions: true },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate tasks");
      }

      await refetchRun();
    } catch (error) {
      console.error("Failed to generate tasks:", error);
      setIsApiCalling(false);
    }
  }, [featureId, workspaceId, refetchRun, isGenerating, isControlled, onControlledTabChange]);

  function renderGenerateTasksButton(): ReactNode {
    if (!hasFeature || hasTasks) return undefined;

    let buttonLabel = "Generate Tasks";
    if (isGenerating) buttonLabel = "Generating...";
    else if (isRunFailed) buttonLabel = "Retry";

    const isDisabled = (!hasArchitecture && !isRunFailed) || isGenerating;
    const needsTooltip = !hasArchitecture && !isRunFailed;

    const btn = (
      <Button
        size="sm"
        onClick={handleGenerateTasks}
        disabled={isDisabled}
        className={`gap-1.5 h-7 text-xs text-white shadow-sm disabled:opacity-40 disabled:pointer-events-auto disabled:cursor-not-allowed ${
          isRunFailed
            ? "bg-amber-500 hover:bg-amber-600"
            : "bg-emerald-600 hover:bg-emerald-700"
        }`}
      >
        {isGenerating ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {buttonLabel}
      </Button>
    );

    if (needsTooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Architecture required to generate tasks</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return btn;
  }

  const availableTabs: ArtifactType[] = useMemo(() => {
    const tabs: ArtifactType[] = [];
    if (planData) tabs.push("PLAN");
    if (hasFeature && showTasksTab) tabs.push("TASKS");
    if (browserArtifacts.length > 0) tabs.push("BROWSER");
    if (workflowArtifacts.length > 0) tabs.push("WORKFLOW");
    if (graphArtifacts.length > 0) tabs.push("GRAPH");
    if (diffArtifacts.length > 0) tabs.push("DIFF");
    if (codeArtifacts.length > 0) tabs.push("CODE");
    if (ideArtifacts.length > 0) tabs.push("IDE");
    return tabs;
  }, [planData, hasFeature, showTasksTab, codeArtifacts.length, browserArtifacts.length, ideArtifacts.length, graphArtifacts.length, workflowArtifacts.length, diffArtifacts.length]);

  // Auto-select first tab, or fall back when active tab is removed
  // Guard: don't reset during active generation to prevent TASKS tab from disappearing
  useEffect(() => {
    if (availableTabs.length > 0 && (!activeTab || !availableTabs.includes(activeTab))) {
      if (hasInitiatedGeneration) return; // Prevent fallback during generation handoff
      // Don't reset a valid controlled tab (e.g. TASKS from URL) just because
      // the tab isn't available yet — wait for data to load
      if (isControlled && activeTab && VALID_PLAN_TABS.includes(activeTab as ArtifactType)) return;
      if (isControlled && onControlledTabChange) {
        onControlledTabChange(availableTabs[0]);
      } else {
        setInternalTab(availableTabs[0]);
      }
    }
  }, [availableTabs, activeTab, isControlled, onControlledTabChange, hasInitiatedGeneration]);

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
              headerAction={renderGenerateTasksButton()}
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
                sectionHighlights={sectionHighlights}
              />
            </div>
          )}
          {hasFeature && showTasksTab && (
            <div className="h-full" hidden={activeTab !== "TASKS"}>
              <div className="h-full overflow-auto p-4">
                <CompactTasksList
                  featureId={featureId!}
                  feature={feature!}
                  onUpdate={onFeatureUpdate!}
                  isGenerating={isGenerating}
                />
              </div>
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
