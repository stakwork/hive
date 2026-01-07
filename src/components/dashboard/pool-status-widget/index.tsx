"use client";

import { useModal } from "@/components/modals/ModlaProvider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { PoolStatusResponse } from "@/types";
import { Loader2, Server } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

export function PoolStatusWidget() {
  const { slug, workspace } = useWorkspace();
  const open = useModal();

  const [poolStatus, setPoolStatus] = useState<PoolStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isPoolActive = workspace?.poolState === "COMPLETE";
  const servicesReady = workspace?.containerFilesSetUp === true;
  const disableAutoLaunch = process.env.NEXT_PUBLIC_DISABLE_AUTO_LAUNCH_PODS === 'true';

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

  // Auto-launch pool when services are ready (unless disabled)
  useEffect(() => {
    if (servicesReady && !isPoolActive && !disableAutoLaunch && slug && workspace?.id) {
      console.log("Auto-launching pool for workspace:", workspace.id);

      const autoLaunchPool = async () => {
        try {
          const poolResponse = await fetch("/api/pool-manager/create-pool", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workspaceId: workspace.id,
            }),
          });

          if (!poolResponse.ok) {
            console.error("Auto-launch pool creation failed:", poolResponse.status);
            return;
          }

          const poolData = await poolResponse.json();
          console.log("Auto-launch pool creation result:", poolData);

          // The workspace state will be updated by the pool creation endpoint
          // or we could trigger a refresh here if needed
        } catch (error) {
          console.error("Auto-launch pool creation error:", error);
        }
      };

      autoLaunchPool();
    }
  }, [servicesReady, isPoolActive, disableAutoLaunch, slug, workspace?.id]);

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

    // Ready to launch pods or show auto-launch status
    if (disableAutoLaunch) {
      return (
        <Button asChild size="sm" className="h-10 gap-2">
          <Link onClick={handleOpenModal} href={`/w/${slug}`}>
            <Server className="w-4 h-4" />
            Launch Pods
          </Link>
        </Button>
      );
    } else {
      // Auto-launch is enabled, show loading state
      return (
        <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <Server className="w-4 h-4 text-foreground" />
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          </div>
          <div className="text-xs font-medium text-muted-foreground">Auto-launching...</div>
        </div>
      );
    }
  }

  return null;
}
