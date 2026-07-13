"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProposedFix } from "@/types/legal";

interface ProposedFixCardProps {
  fix: ProposedFix;
}

/**
 * Derive the badge variant and label from `rerun_status` and `score_delta`.
 */
function RerunBadge({
  rerunStatus,
  scoreDelta,
  beforeScore,
  afterScore,
}: {
  rerunStatus?: string | null;
  scoreDelta?: string | null;
  beforeScore?: string | null;
  afterScore?: string | null;
}) {
  const status = rerunStatus ?? "";

  if (status === "pending" || status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Running…
      </span>
    );
  }

  if (status === "improved") {
    const label =
      beforeScore && afterScore
        ? `Improved ${beforeScore}→${afterScore}${scoreDelta ? ` (${scoreDelta})` : ""}`
        : "Improved";
    return (
      <Badge className="border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        {label}
      </Badge>
    );
  }

  if (status === "no_change") {
    return (
      <Badge className="border-0 bg-muted text-muted-foreground">
        No change
      </Badge>
    );
  }

  if (status === "regressed") {
    return (
      <Badge className="border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
        Regressed
      </Badge>
    );
  }

  // `scored` or any unknown status — derive from the sign of score_delta
  if (status === "scored" || status) {
    const delta = scoreDelta ? parseFloat(scoreDelta) : NaN;
    if (!isNaN(delta)) {
      if (delta > 0) {
        return (
          <Badge className="border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
            {`Improved${beforeScore && afterScore ? ` ${beforeScore}→${afterScore}` : ""} (${scoreDelta})`}
          </Badge>
        );
      }
      if (delta < 0) {
        return (
          <Badge className="border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
            Regressed
          </Badge>
        );
      }
      return (
        <Badge className="border-0 bg-muted text-muted-foreground">
          No change
        </Badge>
      );
    }
  }

  return null;
}

/**
 * Renders a single `ProposedFix` node as a review card.
 * Accept / Reject buttons are visibly disabled in this v1 — wiring is deferred.
 */
export function ProposedFixCard({ fix }: ProposedFixCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 flex-1 min-w-0">
          {fix.prompt_name && (
            <p className="font-semibold text-sm truncate">{fix.prompt_name}</p>
          )}
          {fix.criterion_title && (
            <p className="text-xs text-muted-foreground truncate">{fix.criterion_title}</p>
          )}
        </div>
        <RerunBadge
          rerunStatus={fix.rerun_status}
          scoreDelta={fix.score_delta}
          beforeScore={fix.before_score}
          afterScore={fix.after_score}
        />
      </div>

      {/* Body */}
      <div className="space-y-2 text-sm">
        {fix.delta && (
          <div>
            <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              Change
            </span>
            <p className="mt-0.5 whitespace-pre-wrap">{fix.delta}</p>
          </div>
        )}
        {fix.reasoning && (
          <div>
            <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              Reasoning
            </span>
            <p className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{fix.reasoning}</p>
          </div>
        )}
        {fix.passing_value && (
          <div>
            <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              What would&apos;ve passed
            </span>
            <p className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{fix.passing_value}</p>
          </div>
        )}
        {fix.prompt_version_id && (
          <p className="text-xs text-muted-foreground/70">
            Failed under version <code className="font-mono">{fix.prompt_version_id}</code>
          </p>
        )}
      </div>

      {/* Actions — visibly disabled (v1 demo; wiring deferred) */}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" disabled>
          Accept
        </Button>
        <Button size="sm" variant="outline" disabled>
          Reject
        </Button>
      </div>
    </div>
  );
}
