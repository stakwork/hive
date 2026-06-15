"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkflowSummaryDialog } from "./WorkflowSummaryDialog";
import { getPusherClient, PUSHER_EVENTS } from "@/lib/pusher";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";
import type { Channel } from "pusher-js";

interface WorkflowSummaryReadyEvent {
  summaryId: string;
  workflowId: number;
  content: string;
}

export interface SummariseChangesButtonProps {
  versions: WorkflowVersion[];
  workspaceSlug: string;
  workflowId: number;
  customSelectedIds: string[];
  onCustomModeToggle: (enabled: boolean) => void;
  onCustomSelectionConfirm: () => void;
  isCustomMode: boolean;
}

export function SummariseChangesButton({
  versions,
  workspaceSlug,
  workflowId,
  customSelectedIds,
  onCustomModeToggle,
  isCustomMode,
}: SummariseChangesButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogState, setDialogState] = useState<"loading" | "error" | "content">("loading");
  const [summaryContent, setSummaryContent] = useState<string | undefined>();
  const [currentSummaryId, setCurrentSummaryId] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const lastVersionIdsRef = useRef<string[]>([]);
  const canTrigger = versions.length >= 2;

  const triggerSummary = async (versionIds: string[]) => {
    lastVersionIdsRef.current = versionIds;
    setDialogOpen(true);
    setDialogState("loading");
    setSummaryContent(undefined);
    setErrorMessage(undefined);
    setCurrentSummaryId(undefined);

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/workflows/${workflowId}/summarise`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionIds }),
        },
      );

      if (!res.ok) {
        setDialogState("error");
        setErrorMessage("Failed to start summary workflow.");
        return;
      }

      const { cached, content, summaryId } = await res.json();

      if (cached) {
        setSummaryContent(content);
        setDialogState("content");
        return;
      }

      setCurrentSummaryId(summaryId);
    } catch {
      setDialogState("error");
      setErrorMessage("Failed to start summary workflow.");
    }
  };

  // Pusher subscription — fires when a non-cached summary is in progress
  useEffect(() => {
    if (!currentSummaryId || dialogState !== "loading") return;

    let channel: Channel | undefined;
    try {
      const pusher = getPusherClient();
      channel = pusher.subscribe(`workspace-${workspaceSlug}`);
      channel.bind(
        PUSHER_EVENTS.WORKFLOW_SUMMARY_READY,
        (event: WorkflowSummaryReadyEvent) => {
          if (event.summaryId === currentSummaryId) {
            setSummaryContent(event.content);
            setDialogState("content");
          }
        },
      );
    } catch {
      // Pusher not configured in some envs — no-op
    }

    return () => {
      channel?.unbind_all();
    };
  }, [currentSummaryId, dialogState, workspaceSlug]);

  const handleRecentChanges = () => {
    const ids = versions.slice(0, 5).map((v) => v.workflow_version_id);
    triggerSummary(ids);
  };

  const handleCustomSummary = () => {
    onCustomModeToggle(true);
  };

  const handleRetry = () => {
    if (lastVersionIdsRef.current.length > 0) {
      triggerSummary(lastVersionIdsRef.current);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setCurrentSummaryId(undefined);
    }
  };

  // When custom mode is active and customSelectedIds has 2+, expose a way to confirm
  // This is triggered from WorkflowVersionList's "Generate Summary" button via the page
  // The page calls onCustomSelectionConfirm which in turn calls triggerSummary
  // We expose triggerSummary via a stable ref so the page can call it
  const triggerWithCustomIds = () => {
    if (customSelectedIds.length >= 2) {
      triggerSummary(customSelectedIds);
      onCustomModeToggle(false);
    }
  };

  // Expose triggerWithCustomIds for external call via onCustomSelectionConfirm forwarding
  // The parent page wires onCustomSelectionConfirm → this component's triggerWithCustomIds
  // by passing it down. Since we need the button to call it directly, we handle it here.
  // The prop `onCustomSelectionConfirm` from parent is intentionally unused here —
  // the version list's "Generate Summary" button calls back to the page which calls
  // onCustomSelectionConfirm, but we self-contain the trigger logic.
  // For the page integration, see WorkflowInspectorPage where we wire this up.

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={!canTrigger}
      className="flex items-center gap-1.5"
      asChild={false}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Summarise Changes
    </Button>
  );

  return (
    <>
      <div className="flex items-center gap-1 mb-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canTrigger}
                      className="flex items-center gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Summarise Changes
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      disabled={!canTrigger}
                      onSelect={handleRecentChanges}
                    >
                      Summarise Recent Changes
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canTrigger}
                      onSelect={handleCustomSummary}
                    >
                      Custom Summary…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </TooltipTrigger>
            {!canTrigger && (
              <TooltipContent>
                Need at least 2 versions to compare
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* When custom mode is active, show Cancel and optionally Generate Summary */}
        {isCustomMode && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onCustomModeToggle(false)}>
              Cancel
            </Button>
            {customSelectedIds.length >= 2 && (
              <Button size="sm" variant="default" onClick={triggerWithCustomIds}>
                Generate Summary ({customSelectedIds.length} selected)
              </Button>
            )}
          </>
        )}
      </div>

      <WorkflowSummaryDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        state={dialogState}
        content={summaryContent}
        errorMessage={errorMessage}
        onRetry={handleRetry}
      />
    </>
  );
}
