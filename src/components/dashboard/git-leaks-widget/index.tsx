"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIngestStatus } from "@/hooks/useIngestStatus";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface GitLeaksState {
  count: number;
}

export function GitLeaksWidget() {
  const { slug } = useWorkspace();
  const { isIngesting } = useIngestStatus();
  const [data, setData] = useState<GitLeaksState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchLeaks = useCallback(async () => {
    if (!slug || loading) return;

    setLoading(true);
    setError(false);

    try {
      const response = await fetch(`/api/workspaces/${slug}/git-leaks`);
      const result = await response.json();

      if (response.ok && result.success) {
        setData({
          count: result.count || 0,
        });
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug, loading]);

  // Auto-fetch when ingestion is active and we don't have data
  useEffect(() => {
    if (isIngesting && !data && !loading && !error) {
      fetchLeaks();
    }
  }, [isIngesting, data, loading, error, fetchLeaks]);

  // Only show widget during ingestion
  if (!isIngesting) return null;

  // Loading state - shield with yellow dot
  if (loading) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
              <Shield className="w-5 h-5 text-muted-foreground" />
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs font-medium">Scanning for secrets...</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Error state
  if (error) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={fetchLeaks}
              className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-pointer"
            >
              <Shield className="w-5 h-5 text-muted-foreground" />
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-yellow-500" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs">
              <div className="font-medium text-yellow-600">Scan failed</div>
              <div className="text-muted-foreground">Click to retry</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Not yet scanned
  if (!data) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={fetchLeaks}
              className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-pointer"
            >
              <Shield className="w-5 h-5 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs">
              <div className="font-medium">Secret Scanner</div>
              <div className="text-muted-foreground">Click to scan for leaked secrets</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Data loaded
  const hasLeaks = data.count > 0;
  const Icon = hasLeaks ? ShieldAlert : ShieldCheck;
  const iconColor = hasLeaks ? "text-orange-500" : "text-green-500";
  const statusColor = hasLeaks ? "bg-orange-500" : "bg-green-500";

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Link
            href={`/w/${slug}/recommendations?scan=git-leaks#git-leaks`}
            className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-pointer"
          >
            <Icon className={`w-5 h-5 ${iconColor}`} />
            {hasLeaks ? (
              <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-medium px-1">
                {data.count > 99 ? "99+" : data.count}
              </div>
            ) : (
              <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${statusColor}`} />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="text-xs">
            <div className={`font-medium ${hasLeaks ? "text-orange-600" : "text-green-600"}`}>
              {hasLeaks
                ? `${data.count} secret${data.count !== 1 ? "s" : ""} detected`
                : "No secrets detected"}
            </div>
            {hasLeaks && (
              <div className="text-muted-foreground">Click to view details</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
