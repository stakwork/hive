"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BULK_PROPOSAL_DECISION_CAP,
  type BulkProposalDecisionCode,
  type BulkProposalDecisionResult,
} from "@/types/concept-proposals";

const RETRIABLE_CODES: ReadonlySet<BulkProposalDecisionCode> = new Set([
  "stale_base",
  "upstream_error",
  "not_attempted",
]);

/**
 * After a bulk decision, keep only still-pending failures that the reviewer
 * can immediately retry. Succeeded ids, and failures that vanish from the
 * pending list (`not_found`, `already_decided`), are dropped.
 */
export function reconcileBulkSelection(
  selectedIds: string[],
  results: BulkProposalDecisionResult[],
  pendingIds: Iterable<string>,
): string[] {
  const pending = pendingIds instanceof Set ? pendingIds : new Set(pendingIds);
  const retriable = new Set(
    results
      .filter((result) => !result.ok && result.code && RETRIABLE_CODES.has(result.code))
      .map((result) => result.id),
  );
  return selectedIds.filter((id) => retriable.has(id) && pending.has(id));
}

export function useBulkProposalDecisions(workspaceSlug: string) {
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkProposalDecisionResult[] | null>(null);
  const [lastAction, setLastAction] = useState<"accept" | "reject" | null>(null);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (
      action: "accept" | "reject",
      ids: string[],
    ): Promise<BulkProposalDecisionResult[] | undefined> => {
      if (submitting) return;
      if (submittingRef.current) return;
      if (ids.length === 0 || ids.length > BULK_PROPOSAL_DECISION_CAP) return;

      submittingRef.current = true;
      setSubmitting(true);
      setLastAction(action);
      try {
        const response = await fetch(
          `/api/learnings/concepts/proposals/bulk?workspace=${encodeURIComponent(workspaceSlug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ids }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error(
            typeof data?.error === "string" ? data.error : "Failed to apply bulk decision",
          );
          return undefined;
        }
        const list: BulkProposalDecisionResult[] = Array.isArray(data?.results)
          ? data.results
          : [];
        setResults(list);
        return list;
      } catch {
        toast.error("Failed to apply bulk decision");
        return undefined;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [submitting, workspaceSlug],
  );

  return { submitting, results, lastAction, submit };
}
