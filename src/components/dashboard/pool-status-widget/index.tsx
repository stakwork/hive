"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { _Clock, Loader2, Server } from "lucide-react";
import Link from "next/link";
import { useModal } from "@/components/modals/ModlaProvider";
import { PoolStatusResponse } from "@/types";

export function PoolStatusWidget() {
  const { slug, workspace } = useWorkspace();
  const open = useModal();

  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, _setIsExpanded] = useState(false);

  const isPoolActive = workspace?.poolState === "COMPLETE";
  const servicesReady = workspace?.containerFilesSetUp === true;

  const fetchPoolStatus = useCallback(async () => {
    if (!slug || !isPoolActive) {
      setPoolStatus(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/w/${slug}/pool/status`);
      const result = await response.json();

      if (result.success) {
        setPoolStatus(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch pool status:", error);
    } finally {
      setLoading(false);
    }
  }, [slug, isPoolActive]);

  useEffect(() => {
    fetchPoolStatus();
  }, [fetchPoolStatus]);

  const handleOpenModal = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    open("ServicesWizard");
  };

  // Compact state when pool is active
  if (isPoolActive && !isExpanded) {
    if (loading) {
      return (
        <div className="flex items-center justify-center px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (poolStatus) {
      const totalVms = poolStatus.status.runningVms;
      const hasIssues = poolStatus.status.pendingVms > 0 || poolStatus.status.failedVms > 0;

      return (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                <Server className="w-4 h-4 text-foreground" />
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="text-green-600">{poolStatus.status.usedVms}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{totalVms}</span>
                </div>
                {hasIssues && (
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-1 text-xs">
                <div className="font-medium">Pool Status</div>
                <div className="flex items-center gap-2">
                  <span className="text-green-600">{poolStatus.status.usedVms} in use</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">{poolStatus.status.unusedVms} available</span>
                </div>
                {poolStatus.status.pendingVms > 0 && (
                  <div className="text-yellow-600">
                    {poolStatus.status.pendingVms} pending
                  </div>
                )}
                {poolStatus.status.failedVms > 0 && (
                  <div className="text-red-600">
                    {poolStatus.status.failedVms} failed
                  </div>
                )}
                {poolStatus.status.lastCheck && (
                  <div className="text-muted-foreground">
                    Updated {formatRelativeOrDate(poolStatus.status.lastCheck.endsWith('Z')
                      ? poolStatus.status.lastCheck
                      : poolStatus.status.lastCheck + 'Z')}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return null;
  }

  // Expanded state during setup/ingestion
  if (!isPoolActive) {
    if (!servicesReady) {
      // Services being set up
      return (
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <Server className="w-4 h-4 text-foreground" />
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
          </div>
          <div className="text-xs font-medium text-muted-foreground">Setting up...</div>
        </div>
      );
    }

    // Ready to launch pods
    return (
      <Button asChild size="sm" className="h-10 gap-2">
        <Link onClick={handleOpenModal} href={`/w/${slug}`}>
          <Server className="w-4 h-4" />
          Launch Pods
        </Link>
      </Button>
    );
  }

  return null;
}
