"use client";

import React from "react";
import { ExternalLink, Loader2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SystemMapFindingFix, SystemMapFindingFixStatus } from "@/types/system-map";

const LABEL: Record<SystemMapFindingFixStatus, string> = {
  QUEUED: "Fix queued",
  RUNNING: "Fixing…",
  PR_OPENED: "PR opened",
  FAILED: "Fix failed",
};
const CLASS: Record<SystemMapFindingFixStatus, string> = {
  QUEUED: "border-muted-foreground/30 bg-muted text-muted-foreground",
  RUNNING: "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  PR_OPENED: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  FAILED: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300",
};

/** Status badge for a finding's latest fix, with the PR link once opened. */
export function FixBadge({ fix }: { fix: SystemMapFindingFix }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="finding-fix-status">
      <Badge variant="outline" className={cn(CLASS[fix.status])} title={fix.error ?? undefined}>
        {(fix.status === "RUNNING" || fix.status === "QUEUED") && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {LABEL[fix.status]}
      </Badge>
      {fix.prUrl && (
        <a
          href={fix.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
          data-testid="finding-fix-pr-link"
        >
          View PR <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

/** Per-finding Fix button; disabled with the reason as its tooltip. */
export function FixButton({
  disabledReason,
  busy,
  onClick,
}: {
  disabledReason: string | null;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <span title={disabledReason ?? "Open a pull request that fixes this finding"} className="shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={!!disabledReason || busy}
        onClick={onClick}
        data-testid="finding-fix-button"
      >
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-1 h-3.5 w-3.5" />}
        Fix
      </Button>
    </span>
  );
}
