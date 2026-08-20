"use client";

import React, { useState } from "react";
import { AlertTriangle, ExternalLink, GitBranch } from "lucide-react";
import type { ProposedFix } from "@/types/legal";
import { parseFixSnapshot } from "@/lib/harvey-lab/fix-snapshot";
import { computeUnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import { UnifiedDiffView } from "@/components/diff/UnifiedDiffView";
import { fetchNodePeek, NodePeekBody, ViewInGraphLink } from "@/components/run-report/NodePeek";
import type { NodePeek } from "@/components/run-report/NodePeek";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Badge helpers ─────────────────────────────────────────────────────────────

function StatusChip({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${className}`}
    >
      {children}
    </span>
  );
}

function FixBadge({ state, rejected }: { state: string; rejected?: boolean }) {
  if (rejected) {
    return (
      <StatusChip className="bg-red-500/10 text-red-700 dark:text-red-400">
        rejected
      </StatusChip>
    );
  }
  if (state === "create") {
    return (
      <StatusChip className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        create
      </StatusChip>
    );
  }
  if (state === "edit") {
    return (
      <StatusChip className="bg-blue-500/10 text-blue-700 dark:text-blue-400">
        edit
      </StatusChip>
    );
  }
  return null;
}

// ── Live node peek modal ──────────────────────────────────────────────────────

function LiveNodePeekModal({
  open,
  onOpenChange,
  peek,
  conceptName,
  workspaceSlug,
  refId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  peek: NodePeek | null;
  conceptName: string | null;
  workspaceSlug: string;
  refId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 mb-0.5">
            Live node — current state
          </div>
          <DialogTitle className="text-base break-words [overflow-wrap:anywhere]">
            {conceptName ?? "Graph node"}
          </DialogTitle>
          <div className="text-[11px] text-muted-foreground/60 italic">
            This is the node <em>as it is now</em>, not at fix time — they may
            legitimately differ since the loop keeps mutating concepts.
          </div>
        </DialogHeader>
        <div className="mt-2 min-h-[80px]">
          {!peek ? (
            <div className="text-[12.5px] text-muted-foreground italic">Loading…</div>
          ) : peek.state === "loading" ? (
            <div className="text-[12.5px] text-muted-foreground italic">Loading…</div>
          ) : peek.state === "error" ? (
            <div className="text-[12.5px] text-red-600 dark:text-red-400">{peek.note}</div>
          ) : (
            <NodePeekBody payload={peek.payload} />
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <ViewInGraphLink workspaceSlug={workspaceSlug} refId={refId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface FixSnapshotPanelProps {
  fix: ProposedFix;
  workspaceSlug: string;
}

/**
 * Generic fix-snapshot panel — reads target-snapshot fields from a ProposedFix
 * and renders a before/after diff, badges, and a live-node link.
 *
 * Generic: keyed off `target_type`, not per-fix-type branching.
 * Sanitization: all graph-authored strings render as escaped React text or
 * through SafeMarkdown — never dangerouslySetInnerHTML.
 * Workflow kind: body suppressed entirely (may contain credentials).
 */
export function FixSnapshotPanel({ fix, workspaceSlug }: FixSnapshotPanelProps) {
  const snapshot = parseFixSnapshot(fix);
  const [peekOpen, setPeekOpen] = useState(false);
  const [peek, setPeek] = useState<NodePeek | null>(null);

  // Canonicalize status for rejected badge
  const canonicalStatus = fix.eval_status ?? fix.status;
  const isRejected = canonicalStatus?.toLowerCase() === "rejected";

  const handleOpenLiveNode = async () => {
    setPeekOpen(true);
    if (!peek || peek.state === "error") {
      setPeek({ state: "loading" });
      const result = await fetchNodePeek(workspaceSlug, snapshot.refId);
      setPeek(result);
    }
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <FixBadge state={snapshot.state} rejected={isRejected} />
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
        {snapshot.kind}
      </span>
      {snapshot.title && (
        <span className="text-[13px] font-medium break-words">
          {snapshot.title}
        </span>
      )}
      {snapshot.version && (
        <span className="font-mono text-[10.5px] text-muted-foreground/60">
          v{snapshot.version}
        </span>
      )}
    </div>
  );

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: React.ReactNode;

  if (snapshot.state === "unparseable") {
    body = (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Snapshot could not be parsed — raw value shown below.</span>
        </div>
        {snapshot.raw?.after && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground bg-muted/30 rounded p-2">
            {/* Raw string rendered as escaped text — never innerHTML */}
            {snapshot.raw.after}
          </pre>
        )}
        {snapshot.raw?.before && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground bg-muted/30 rounded p-2">
            {snapshot.raw.before}
          </pre>
        )}
      </div>
    );
  } else if (snapshot.state === "empty") {
    body = (
      <p className="text-[12.5px] text-muted-foreground italic">
        {snapshot.kind !== "unknown"
          ? `No snapshot recorded for this ${snapshot.kind} fix — it may predate the snapshot system.`
          : "No snapshot recorded for this fix — it may predate the snapshot system."}
      </p>
    );
  } else if (snapshot.state === "create") {
    // Create: show only the "after" content
    const diff = computeUnifiedDiff("", snapshot.after ?? "");
    body = (
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60 mb-1">
          Created content
        </div>
        <UnifiedDiffView diff={diff} emptyText="No content in snapshot." />
      </div>
    );
  } else {
    // Edit: show before/after diff
    const diff = computeUnifiedDiff(snapshot.before ?? "", snapshot.after ?? "");
    body = (
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60 mb-1">
          Changes
        </div>
        <UnifiedDiffView diff={diff} emptyText="No changes detected." />
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" data-testid="fix-snapshot-panel">
      {header}
      {body}

      {/* Live-node control — only when target_ref is present */}
      {snapshot.refId && (
        <div className="pt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenLiveNode}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-primary transition-colors hover:border-primary/50 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="fix-snapshot-live-node-btn"
          >
            <GitBranch className="h-3 w-3" />
            Live node (now)
          </button>
          <span className="text-[11px] text-muted-foreground/60 italic">
            above is the snapshot at fix time
          </span>
        </div>
      )}

      {snapshot.refId && (
        <LiveNodePeekModal
          open={peekOpen}
          onOpenChange={setPeekOpen}
          peek={peek}
          conceptName={snapshot.title}
          workspaceSlug={workspaceSlug}
          refId={snapshot.refId}
        />
      )}
    </div>
  );
}
