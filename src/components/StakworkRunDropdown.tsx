"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";

interface StakworkRunDropdownProps {
  projectId: string;
  workflowId?: number | string;
  hiveUrl: string;
  variant?: "button" | "link";
}

type WorkflowFetchState = "idle" | "loading" | "ready" | "error";

export function StakworkRunDropdown({
  projectId,
  workflowId: initialWorkflowId,
  hiveUrl,
  variant = "button",
}: StakworkRunDropdownProps) {
  const [workflowFetchState, setWorkflowFetchState] = useState<WorkflowFetchState>("idle");
  const [fetchedWorkflowId, setFetchedWorkflowId] = useState<number | string | null>(null);

  // Use provided workflowId or fetched one
  const workflowId = initialWorkflowId ?? fetchedWorkflowId;

  const handleOpenChange = async (open: boolean) => {
    // Only fetch if opening, no workflowId provided, and not already fetched/fetching
    if (open && !initialWorkflowId && workflowFetchState === "idle") {
      setWorkflowFetchState("loading");
      try {
        const response = await fetch(`/api/stakwork/projects/${projectId}`);
        const data = await response.json();

        if (data.success && data.data?.project?.workflow_id) {
          setFetchedWorkflowId(data.data.project.workflow_id);
          setWorkflowFetchState("ready");
        } else {
          setWorkflowFetchState("error");
        }
      } catch (error) {
        console.error("Failed to fetch workflow ID:", error);
        setWorkflowFetchState("error");
      }
    }
  };

  const handleMenuItemClick = (url: string) => {
    window.open(url, "_blank");
  };

  const isWorkflowLoading = workflowFetchState === "loading";
  const isWorkflowError = workflowFetchState === "error";
  const isWorkflowReady = !!workflowId;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        {variant === "button" ? (
          <Button variant="outline" size="sm">
            Stak Run
            <ChevronDown className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            Stak Run
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleMenuItemClick(hiveUrl)}>
          <ExternalLink className="w-4 h-4 mr-2" />
          View Run on Hive
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            handleMenuItemClick(`https://jobs.stakwork.com/admin/projects/${projectId}`)
          }
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          View Run on Stak
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isWorkflowReady || isWorkflowLoading}
          onClick={() =>
            isWorkflowReady &&
            handleMenuItemClick(`https://jobs.stakwork.com/admin/workflows/${workflowId}`)
          }
        >
          {isWorkflowLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : isWorkflowError ? (
            <ExternalLink className="w-4 h-4 mr-2 opacity-50" />
          ) : (
            <ExternalLink className="w-4 h-4 mr-2" />
          )}
          {isWorkflowError ? "Workflow unavailable" : "View Workflow in Stak"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
