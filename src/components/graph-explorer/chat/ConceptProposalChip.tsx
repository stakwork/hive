"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import { UnifiedDiffView, SECTION_LABEL_CLASS } from "@/components/diff/UnifiedDiffView";
import {
  conceptProposalLabel,
  type ConceptProposal,
  type ProposalAction,
  type ProposalStatus,
} from "@/types/concept-proposals";

/**
 * Read-only proposal card shown under a completed run in a proposals-enabled
 * graph chat thread. No accept/reject here — deciding lives on /learn, so the
 * chip only badges the action/status, shows the rationale, expands a
 * read-only diff, and deep-links to the review UI.
 */

const ACTION_BADGE_CLASS: Record<ProposalAction, string> = {
  create: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  update: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  delete: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  merge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const STATUS_BADGE_CLASS: Record<ProposalStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function ConceptProposalChip({ proposal, workspaceSlug }: { proposal: ConceptProposal; workspaceSlug: string }) {
  const [expanded, setExpanded] = useState(false);

  // Per-action diff shapes (per PROPOSALS_API): create is all-added docs,
  // update is baseDocs → documentation, delete removes baseDocs, merge is the
  // survivor's diff plus the absorbed concept's docs shown removed.
  // Note: diffing to "" yields one blank "added" line — expected lib behavior.
  const diffs = useMemo(() => {
    if (!expanded) return null;
    switch (proposal.action) {
      case "create":
        return { main: computeUnifiedDiff("", proposal.documentation ?? "") };
      case "update":
        return {
          main: computeUnifiedDiff(proposal.baseDocs ?? "", proposal.documentation ?? ""),
        };
      case "delete":
        return { main: computeUnifiedDiff(proposal.baseDocs ?? "", "") };
      case "merge":
        return {
          main: computeUnifiedDiff(proposal.baseDocs ?? "", proposal.documentation ?? ""),
          absorbed: computeUnifiedDiff(proposal.absorbedDocs ?? "", ""),
        };
    }
  }, [expanded, proposal]);

  return (
    <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5" data-testid={`proposal-chip-${proposal.id}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Badge
          variant="secondary"
          className={`uppercase text-[10px] ${ACTION_BADGE_CLASS[proposal.action]}`}
          data-testid="proposal-chip-action"
        >
          {proposal.action}
        </Badge>
        {proposal.status !== "pending" && (
          <Badge
            variant="secondary"
            className={`text-[10px] ${STATUS_BADGE_CLASS[proposal.status]}`}
            data-testid="proposal-chip-status"
          >
            {proposal.status}
          </Badge>
        )}
        <span className="text-xs font-medium truncate" title={conceptProposalLabel(proposal)}>
          {conceptProposalLabel(proposal)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{proposal.rationale}</p>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={() => setExpanded((v) => !v)}
          data-testid="proposal-chip-diff-toggle"
        >
          {expanded ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
          View diff
        </Button>
        <Link
          href={`/w/${workspaceSlug}/learn?proposal=${proposal.id}`}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          data-testid="proposal-chip-learn-link"
        >
          Review on Learn
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {expanded && diffs && (
        <div className="space-y-2 pt-1">
          <UnifiedDiffView diff={diffs.main} emptyText="No documentation changes." />
          {"absorbed" in diffs && diffs.absorbed && (
            <div className="space-y-1">
              <div className={SECTION_LABEL_CLASS}>Absorbed concept ({proposal.conceptId ?? "?"})</div>
              <UnifiedDiffView diff={diffs.absorbed} emptyText="No absorbed documentation." />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
