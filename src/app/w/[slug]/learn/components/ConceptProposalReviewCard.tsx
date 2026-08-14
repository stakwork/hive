"use client";

import React, { useMemo, useState } from "react";
import { Check, X, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import {
  UnifiedDiffView,
  SECTION_LABEL_CLASS,
} from "@/components/diff/UnifiedDiffView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import {
  conceptProposalLabel,
  type ConceptProposal,
  type ProposalStatus,
} from "@/types/concept-proposals";

/**
 * Review surface for a single concept change proposal on /learn.
 *
 * Deliberately NOT the org-canvas ProposalCard — that component is coupled
 * to the canvas chat store and applies decisions through chat messages.
 * Here decisions go straight to the proposal proxy routes:
 *   POST /api/learnings/concepts/proposals/[id]/accept?workspace=<slug>
 *   POST /api/learnings/concepts/proposals/[id]/reject?workspace=<slug>
 *
 * 409 handling mirrors the swarm contract:
 *   { code: "stale_base", conceptId } → concept drifted since the proposal
 *     was filed; offer re-review against current docs and explicit force.
 *   { status } → already decided elsewhere; terminal, no force.
 *   404 → proposal or target gone; terminal, no force.
 */

const ACTION_LABEL: Record<ConceptProposal["action"], string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  merge: "Merge",
};

type TerminalState =
  | { kind: "decided"; status: ProposalStatus }
  | { kind: "gone" };

interface StaleBaseState {
  conceptId: string;
  /** Current docs of the drifted concept, once re-fetched (null = not yet). */
  currentDocs: string | null;
  isRefetching: boolean;
}

export interface ConceptProposalReviewCardProps {
  proposal: ConceptProposal;
  workspaceSlug: string;
  /**
   * A decision landed here (accepted/rejected). Parent should refresh
   * proposals + concepts; `createdConceptId` is set when accepting a
   * create proposal so the parent can open the new concept.
   */
  onDecided: (result: {
    outcome: "accepted" | "rejected";
    createdConceptId?: string;
  }) => void;
  /**
   * The proposal turned out to be already decided or gone (409/404).
   * Parent should refresh the proposals list; the card keeps showing
   * its terminal banner.
   */
  onTerminal: () => void;
}

export function ConceptProposalReviewCard({
  proposal,
  workspaceSlug,
  onDecided,
  onTerminal,
}: ConceptProposalReviewCardProps) {
  // canWrite = DEVELOPER and above — same threshold the accept/reject
  // proxy routes enforce server-side.
  const { canWrite } = useWorkspaceAccess();

  const [submitting, setSubmitting] = useState<"accept" | "reject" | null>(null);
  const [staleBase, setStaleBase] = useState<StaleBaseState | null>(null);
  const [terminal, setTerminal] = useState<TerminalState | null>(null);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const baseDocs = proposal.baseDocs ?? "";
  const proposedDocs = proposal.documentation ?? "";

  // Primary diff per action: update/merge propose new docs over the edited
  // concept's snapshot; delete shows the docs fully removed; create has no
  // base and renders the proposed docs verbatim instead of a diff.
  const diff = useMemo(() => {
    if (proposal.action === "create") return null;
    if (proposal.action === "delete") return computeUnifiedDiff(baseDocs, "");
    return computeUnifiedDiff(baseDocs, proposedDocs);
  }, [proposal.action, baseDocs, proposedDocs]);

  // Merge only: the absorbed concept's docs, shown as removed so the two
  // sides of the merge aren't conflated in one diff.
  const absorbedDiff = useMemo(
    () =>
      proposal.action === "merge"
        ? computeUnifiedDiff(proposal.absorbedDocs ?? "", "")
        : null,
    [proposal.action, proposal.absorbedDocs],
  );

  // After a stale_base 409 + re-fetch: diff against the concept's CURRENT
  // docs so the reviewer sees what force-accept would actually overwrite.
  const currentDiff = useMemo(
    () =>
      staleBase?.currentDocs != null
        ? computeUnifiedDiff(staleBase.currentDocs, proposedDocs)
        : null,
    [staleBase?.currentDocs, proposedDocs],
  );

  const decide = async (
    kind: "accept" | "reject",
    opts?: { force?: boolean },
  ) => {
    if (submitting) return;
    setSubmitting(kind);
    try {
      const url = `/api/learnings/concepts/proposals/${encodeURIComponent(
        proposal.id,
      )}/${kind}?workspace=${encodeURIComponent(workspaceSlug)}`;
      const body =
        kind === "accept"
          ? opts?.force
            ? { force: true }
            : {}
          : rejectReason.trim()
            ? { reason: rejectReason.trim() }
            : {};
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        toast.success(
          kind === "accept" ? "Proposal accepted" : "Proposal rejected",
        );
        onDecided({
          outcome: kind === "accept" ? "accepted" : "rejected",
          createdConceptId:
            kind === "accept" && proposal.action === "create"
              ? (data?.proposal?.createdConceptId ?? undefined)
              : undefined,
        });
        return;
      }

      if (response.status === 409 && data?.code === "stale_base") {
        setStaleBase({
          conceptId: data.conceptId ?? proposal.conceptId ?? "",
          currentDocs: null,
          isRefetching: false,
        });
        return;
      }

      if (response.status === 409 && data?.status) {
        setTerminal({ kind: "decided", status: data.status });
        onTerminal();
        return;
      }

      if (response.status === 404) {
        setTerminal({ kind: "gone" });
        onTerminal();
        return;
      }

      toast.error(data?.error ?? `Failed to ${kind} proposal`);
    } catch (error) {
      console.error(`Failed to ${kind} proposal:`, error);
      toast.error(`Failed to ${kind} proposal`);
    } finally {
      setSubmitting(null);
    }
  };

  const refetchCurrentDocs = async () => {
    if (!staleBase || staleBase.isRefetching) return;
    setStaleBase({ ...staleBase, isRefetching: true });
    try {
      const response = await fetch(
        `/api/learnings/concepts/${encodeURIComponent(
          staleBase.conceptId,
        )}?workspace=${encodeURIComponent(workspaceSlug)}`,
      );
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = await response.json();
      const documentation =
        data?.concept?.documentation ?? data?.feature?.documentation ?? "";
      setStaleBase({
        conceptId: staleBase.conceptId,
        currentDocs: documentation,
        isRefetching: false,
      });
    } catch (error) {
      console.error("Failed to re-fetch concept docs:", error);
      toast.error("Failed to load the concept's current documentation");
      setStaleBase({ ...staleBase, isRefetching: false });
    }
  };

  const isBusy = submitting !== null;

  return (
    <div
      className="mx-auto max-w-3xl p-6 space-y-4"
      data-testid="proposal-review-card"
    >
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="proposal-action-badge">
            {ACTION_LABEL[proposal.action]}
          </Badge>
          <h2 className="text-lg font-semibold break-words [overflow-wrap:anywhere]">
            {conceptProposalLabel(proposal)}
          </h2>
        </div>
        {proposal.description && (
          <p className="text-sm text-muted-foreground">{proposal.description}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="space-y-2 rounded-md border p-3">
        <div>
          <div className={SECTION_LABEL_CLASS}>Rationale</div>
          <p className="text-sm">{proposal.rationale}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className={SECTION_LABEL_CLASS}>Source&nbsp;</span>
            {/^https?:\/\//.test(proposal.source) ? (
              <a
                href={proposal.source}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {proposal.source}
              </a>
            ) : (
              proposal.source
            )}
          </span>
          {proposal.prNumbers.length > 0 && (
            <span data-testid="proposal-pr-numbers">
              <span className={SECTION_LABEL_CLASS}>PRs&nbsp;</span>
              {proposal.prNumbers.map((n) => `#${n}`).join(", ")}
            </span>
          )}
          <span className="font-mono">{proposal.repo}</span>
        </div>
      </div>

      {/* Terminal state: decided elsewhere or gone. */}
      {terminal && (
        <div
          className="rounded-md border border-muted bg-muted/30 p-3 text-sm"
          data-testid="proposal-terminal-state"
        >
          {terminal.kind === "decided"
            ? `This proposal was already ${terminal.status}.`
            : "This proposal no longer exists — it may have been decided or its concept removed."}
        </div>
      )}

      {/* Stale base: concept drifted since the proposal was filed. */}
      {!terminal && staleBase && (
        <div
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          data-testid="proposal-stale-banner"
        >
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <span className="font-mono">{staleBase.conceptId}</span> has
              changed since this was proposed — re-review before accepting.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={refetchCurrentDocs}
              disabled={staleBase.isRefetching || isBusy}
              data-testid="proposal-stale-refetch"
            >
              {staleBase.isRefetching ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Compare with current docs
            </Button>
            {canWrite && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => decide("accept", { force: true })}
                disabled={isBusy}
                data-testid="proposal-force-accept-button"
              >
                {submitting === "accept" && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                Accept anyway
              </Button>
            )}
          </div>
          {currentDiff && (
            <div className="space-y-1" data-testid="proposal-current-diff">
              <div className={SECTION_LABEL_CLASS}>
                Proposed change vs current documentation
              </div>
              <UnifiedDiffView
                diff={currentDiff}
                emptyText="The concept's current documentation already matches this proposal."
              />
            </div>
          )}
        </div>
      )}

      {/* Proposal body per action */}
      {proposal.action === "create" ? (
        <div className="space-y-1">
          <div className={SECTION_LABEL_CLASS}>Proposed documentation</div>
          <pre
            className="whitespace-pre-wrap break-words rounded border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed"
            data-testid="proposal-create-docs"
          >
            {proposedDocs}
          </pre>
        </div>
      ) : (
        diff && (
          <div className="space-y-1" data-testid="proposal-diff">
            <div className={SECTION_LABEL_CLASS}>
              {proposal.action === "delete"
                ? "Documentation to remove"
                : proposal.action === "merge"
                  ? `Surviving concept — ${proposal.mergeIntoConceptId}`
                  : `Documentation change — ${proposal.conceptId}`}
            </div>
            <UnifiedDiffView diff={diff} emptyText="No documentation change." />
          </div>
        )
      )}

      {absorbedDiff && (
        <div className="space-y-1" data-testid="proposal-absorbed-docs">
          <div className={SECTION_LABEL_CLASS}>
            Absorbed concept (removed) — {proposal.conceptId}
          </div>
          <UnifiedDiffView
            diff={absorbedDiff}
            emptyText="The absorbed concept has no documentation."
          />
        </div>
      )}

      {/* Decision controls */}
      {!terminal &&
        (canWrite ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {!staleBase && (
                <Button
                  size="sm"
                  onClick={() => decide("accept")}
                  disabled={isBusy}
                  data-testid="proposal-accept-button"
                >
                  {submitting === "accept" ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  Accept
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsRejectOpen((open) => !open)}
                disabled={isBusy}
                data-testid="proposal-reject-button"
              >
                <X className="mr-1 h-3 w-3" />
                Reject
              </Button>
            </div>
            {isRejectOpen && (
              <div className="space-y-2">
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="min-h-16 text-sm"
                  data-testid="proposal-reject-reason"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => decide("reject")}
                  disabled={isBusy}
                  data-testid="proposal-reject-confirm"
                >
                  {submitting === "reject" && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  Confirm reject
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="proposal-readonly-note"
          >
            Reviewing proposals requires developer access.
          </p>
        ))}
    </div>
  );
}
