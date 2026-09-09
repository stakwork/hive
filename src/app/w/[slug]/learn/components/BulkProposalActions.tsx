"use client";

import React, { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  BULK_PROPOSAL_DECISION_CAP,
  BULK_PROPOSAL_FAILURE_MESSAGE,
  type BulkProposalDecisionCode,
  type BulkProposalDecisionResult,
} from "@/types/concept-proposals";
import { cn } from "@/lib/utils";

interface BulkProposalActionsProps {
  selectedCount: number;
  submitting: boolean;
  results: BulkProposalDecisionResult[] | null;
  lastAction: "accept" | "reject" | null;
  onAccept: () => void;
  onReject: () => void;
}

function failureCopy(code: BulkProposalDecisionCode | undefined): string {
  if (code && code in BULK_PROPOSAL_FAILURE_MESSAGE) {
    return BULK_PROPOSAL_FAILURE_MESSAGE[code];
  }
  return BULK_PROPOSAL_FAILURE_MESSAGE.upstream_error;
}

export function BulkProposalActions({
  selectedCount,
  submitting,
  results,
  lastAction,
  onAccept,
  onReject,
}: BulkProposalActionsProps) {
  const toastedFor = useRef<BulkProposalDecisionResult[] | null>(null);
  const overCap = selectedCount > BULK_PROPOSAL_DECISION_CAP;
  const disabled = submitting || selectedCount === 0 || overCap;
  const failures = (results ?? []).filter((result) => !result.ok);

  useEffect(() => {
    if (!results || toastedFor.current === results) return;
    toastedFor.current = results;
    const successCount = results.filter((result) => result.ok).length;
    if (successCount === 0) return;
    const verb = lastAction === "reject" ? "Rejected" : "Accepted";
    const noun = successCount === 1 ? "proposal" : "proposals";
    toast.success(`${verb} ${successCount} ${noun}`);
  }, [results, lastAction]);

  if (selectedCount === 0 && failures.length === 0) return null;

  return (
    <div
      data-testid="learn-bulk-proposal-actions"
      className="border-t border-border bg-background px-3 py-2 space-y-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">
          {selectedCount} selected
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={disabled}
            onClick={onAccept}
            data-testid="learn-bulk-accept"
          >
            {submitting && lastAction === "accept" ? "Accepting…" : "Accept selected"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onReject}
            data-testid="learn-bulk-reject"
          >
            {submitting && lastAction === "reject" ? "Rejecting…" : "Reject selected"}
          </Button>
        </div>
      </div>
      {overCap && (
        <p className="text-xs text-muted-foreground">
          Select at most {BULK_PROPOSAL_DECISION_CAP} proposals.
        </p>
      )}
      {failures.length > 0 && (
        <ul className="space-y-1" data-testid="learn-bulk-failures">
          {failures.map((result) => (
            <li
              key={result.id}
              data-testid="learn-bulk-proposal-failure"
              className={cn("text-xs text-muted-foreground truncate")}
            >
              <span className="font-medium text-foreground">{result.id}</span>
              {" — "}
              {failureCopy(result.code)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
