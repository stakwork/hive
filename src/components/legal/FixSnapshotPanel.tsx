"use client";

import React, { useMemo, useState } from "react";
import { FileDiff, Share2 } from "lucide-react";
import {
  parseFixSnapshot,
  resolveFixStatus,
  type FixSnapshotProps,
} from "@/lib/harvey-lab/fix-snapshot";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import { UnifiedDiffView } from "@/components/diff/UnifiedDiffView";
import { Section, Panel, StatusBadge, SectionErrorBoundary } from "@/components/run-report/chrome";
import {
  NodePeekBody,
  ViewInGraphLink,
  fetchNodePeek,
  graphExplorerHref,
  type NodePeek,
} from "@/components/run-report/NodePeek";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Generic before/after fix snapshot reader — ONE component keyed off the
 * parsed snapshot `kind` (target_type ?? fix_type), never per-fix-type
 * branching. That single-reader property is why the ontology's snapshot was
 * generalized in the first place; new target kinds render through the same
 * path (metadata + resolved body diff) with zero code here.
 *
 * SANITIZATION IS MANDATORY: `old_value` / `new_value` / `target_name` are
 * graph-authored and untrusted. Every snapshot string — including the
 * unparseable `raw` fallback — renders as escaped React text through the diff
 * rows or plain <pre>. No markdown passthrough, no dangerouslySetInnerHTML.
 * Additionally, workflow-target snapshots can embed credentials/secrets, so
 * for `kind === "workflow"` the body (and the raw fallback) is suppressed
 * entirely — metadata only.
 */

/** Panel input: the snapshot subset plus display extras both surfaces carry. */
export type FixSnapshotPanelFix = FixSnapshotProps & {
  fromThisRun?: boolean;
  criterion_title?: string | null;
};

// ── Live-node peek ────────────────────────────────────────────────────────────

/**
 * "As of fix time — open live node": composes the shared peek primitives
 * (fetchNodePeek / NodePeekBody / ViewInGraphLink) into a dialog, the same
 * shell ReportHeader's ConceptStrip and CascadeRow's ConceptChip each build.
 * The loop keeps mutating concepts, so the live node can legitimately diverge
 * from the snapshot — that divergence is itself signal for the reviewer.
 * Rendered only when the fix recorded a `target_ref`.
 */
function LiveNodeControl({
  workspaceSlug,
  refId,
  title,
  kind,
}: {
  workspaceSlug: string | null;
  refId: string;
  title: string | null;
  kind: string;
}) {
  const [peek, setPeek] = useState<NodePeek | null>(null);

  const openPeek = async () => {
    setPeek({ state: "loading" });
    setPeek(await fetchNodePeek(workspaceSlug, refId));
  };

  return (
    <>
      <button
        type="button"
        onClick={openPeek}
        data-testid="fix-snapshot-live-node"
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-primary transition-colors hover:border-primary/50 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Share2 className="h-3 w-3" />
        as of fix time — open live node
      </button>

      <Dialog open={peek !== null} onOpenChange={(next) => !next && setPeek(null)}>
        <DialogContent className="max-w-2xl" data-testid="fix-snapshot-live-node-peek">
          <DialogHeader>
            <ViewInGraphLink workspaceSlug={workspaceSlug} refId={refId} />
            <DialogTitle className="flex items-baseline gap-2 text-[15px]">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
                {kind}
              </span>
              {title ?? "Live node"}
            </DialogTitle>
          </DialogHeader>
          <div className="font-mono text-[10px] text-muted-foreground/60 -mt-2 truncate">
            ref {refId}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            This is the node as it is NOW — the snapshot above was taken at fix
            time, and the loop may have mutated the node since.
          </p>
          {peek?.state === "loading" && (
            <p className="text-[12.5px] italic text-muted-foreground">fetching from the graph…</p>
          )}
          {peek?.state === "error" && (
            <p className="text-[12.5px] text-muted-foreground">{peek.note}</p>
          )}
          {peek?.state === "done" && (
            <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
              <NodePeekBody payload={peek.payload} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── The generic reader ────────────────────────────────────────────────────────

export function FixSnapshotPanel({
  fix,
  workspaceSlug,
}: {
  fix: FixSnapshotPanelFix;
  workspaceSlug: string | null;
}) {
  const parsed = useMemo(() => parseFixSnapshot(fix), [fix]);
  const status = resolveFixStatus(fix);
  const rejected = status === "rejected";
  // Workflow snapshots can embed credentials/secrets — metadata only, and the
  // suppression also covers the unparseable raw fallback.
  const suppressBody = parsed.kind === "workflow";

  const diff = useMemo(() => {
    if (suppressBody) return null;
    if (parsed.state !== "create" && parsed.state !== "edit") return null;
    return computeUnifiedDiff(parsed.before, parsed.after);
  }, [parsed, suppressBody]);

  return (
    <div className="space-y-2.5" data-testid="fix-snapshot-panel">
      {/* Identity: kind · name · version · lifecycle badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          {parsed.kind}
        </span>
        <span className="text-[13.5px] font-medium break-words [overflow-wrap:anywhere]">
          {parsed.title ?? "(unnamed target)"}
        </span>
        {parsed.version && (
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            v{parsed.version}
          </span>
        )}
        {parsed.state === "create" && (
          <span data-testid="fix-snapshot-badge-create">
            <StatusBadge kind="pass">created</StatusBadge>
          </span>
        )}
        {parsed.state === "edit" && (
          <span data-testid="fix-snapshot-badge-edit">
            <StatusBadge kind="muted">edited</StatusBadge>
          </span>
        )}
        {rejected && (
          <span data-testid="fix-snapshot-badge-rejected">
            <StatusBadge kind="fail">rejected</StatusBadge>
          </span>
        )}
        {fix.fromThisRun === true && (
          <span data-testid="fix-snapshot-badge-this-run">
            <StatusBadge kind="warn">this run</StatusBadge>
          </span>
        )}
      </div>

      {fix.criterion_title && (
        <div className="text-[11.5px] text-muted-foreground break-words [overflow-wrap:anywhere]">
          criterion: {fix.criterion_title}
        </div>
      )}

      {/* Body — one branch per parse STATE, not per fix type */}
      {suppressBody ? (
        <p
          className="text-[12px] text-muted-foreground italic"
          data-testid="fix-snapshot-workflow-suppressed"
        >
          Workflow snapshot body withheld — workflow definitions can embed
          credentials. Metadata only; use the live node link for details.
        </p>
      ) : parsed.state === "unparseable" ? (
        <div data-testid="fix-snapshot-unparseable">
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            This snapshot&apos;s payload couldn&apos;t be parsed — showing the raw
            envelope instead.
          </p>
          {parsed.raw && (
            <pre className="mt-1.5 max-h-48 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap break-words">
              {parsed.raw}
            </pre>
          )}
        </div>
      ) : parsed.state === "empty" ? (
        <p className="text-[12px] text-muted-foreground italic" data-testid="fix-snapshot-empty">
          No before/after snapshot was recorded on this fix. Fixes proposed
          before snapshots were introduced carry prompt metadata only.
        </p>
      ) : (
        diff && (
          <div data-testid="fix-snapshot-diff">
            <div className="mb-1 font-mono text-[10.5px]">
              <span className="text-emerald-600 dark:text-emerald-400">+{diff.added}</span>{" "}
              <span className="text-rose-600 dark:text-rose-400">−{diff.removed}</span>
            </div>
            <UnifiedDiffView diff={diff} emptyText="Snapshot recorded no textual change." />
          </div>
        )
      )}

      {/* Live-node click-through — suppressed (not broken) without a target_ref.
          The ProposedFix node itself gets its own graph link: the target shows
          what changed, the fix node shows the loop's decision trail
          (DERIVED_FROM chain, eval_status, rerun attribution). */}
      {(parsed.refId || (fix.ref_id && workspaceSlug)) && (
        <div className="flex flex-wrap items-center gap-2">
          {parsed.refId && (
            <LiveNodeControl
              workspaceSlug={workspaceSlug}
              refId={parsed.refId}
              title={parsed.title}
              kind={parsed.kind}
            />
          )}
          {fix.ref_id && workspaceSlug && (
            <a
              href={graphExplorerHref(workspaceSlug, fix.ref_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="fix-snapshot-fix-node-link"
            >
              <Share2 className="h-3 w-3" />
              fix node in graph
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Rail diff control ─────────────────────────────────────────────────────────

/**
 * Compact control for the recursion activity rail: renders a diff icon that
 * opens the full reader in a dialog. Callers gate on the row actually
 * carrying a snapshot — legacy fixes never get the control.
 */
export function FixSnapshotDiffControl({
  fix,
  workspaceSlug,
  testId,
}: {
  fix: FixSnapshotPanelFix;
  workspaceSlug: string | null;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const title = typeof fix.target_name === "string" && fix.target_name.trim() !== "" ? fix.target_name : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`View fix snapshot${title ? ` — ${title}` : ""}`}
        aria-label="View fix snapshot"
        data-testid={testId ?? "fix-snapshot-diff-control"}
        className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <FileDiff className="h-3 w-3 shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Fix snapshot</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto overscroll-contain">
            <FixSnapshotPanel fix={fix} workspaceSlug={workspaceSlug} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Run report section ────────────────────────────────────────────────────────

/**
 * The run report's fix snapshot section. Honestly labeled: the underlying
 * graph query is task-scoped (a runId only ever resolved the slug), so this
 * is the TASK's fix history; entries attributable to the viewed run are
 * badged "this run" and sorted first by the server helper.
 */
export function FixSnapshotSection({
  fixes,
  workspaceSlug,
}: {
  fixes: FixSnapshotPanelFix[];
  workspaceSlug: string | null;
}) {
  if (fixes.length === 0) return null;
  return (
    <Section
      id="fix-snapshots"
      kicker="Fix loop"
      title="Concept changes from this task's fix loop"
      lede="Every fix the loop proposed for this task, with the before/after snapshot taken at fix time. The loop keeps mutating concepts, so a snapshot can diverge from the live node — open the live node to compare; that divergence is itself signal."
    >
      <div className="space-y-4">
        {fixes.map((fix, i) => (
          <Panel key={fix.ref_id ?? i}>
            <SectionErrorBoundary>
              <FixSnapshotPanel fix={fix} workspaceSlug={workspaceSlug} />
            </SectionErrorBoundary>
          </Panel>
        ))}
      </div>
    </Section>
  );
}
