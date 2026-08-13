"use client";

import React, { useState } from "react";
import type { RunReportProjection } from "@/lib/run-report/types";
import { asString, isRecord } from "@/lib/run-report/derive";
import type { ChainModel, ConceptPull } from "@/lib/run-report/chain";
import { StatusBadge, Chip, Kicker, MiniHeading, renderValue } from "./chrome";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatInUserTz } from "@/lib/date-utils";

/**
 * Report header — sets the scene before anything else: task, score, goal,
 * the materials (deliverable + input documents), and the concepts the run
 * pulled. Everything here is deterministic bundle data.
 */

type OpenDoc = (docId: string, tokens: string[]) => void;

/**
 * Renders the lingo node response as a concept card: properties, then edges
 * grouped by type with neighbor chips. Unknown shapes fall back to the
 * generic value tree so the dialog never blanks.
 */
function NodePeekBody({ payload }: { payload: unknown }) {
  if (!isRecord(payload)) {
    return <div className="text-[12.5px]">{renderValue(payload)}</div>;
  }
  const node = isRecord(payload.node) ? payload.node : payload;
  const edges = Array.isArray(payload.edges) ? payload.edges.filter(isRecord) : [];

  const added = node.date_added_to_graph;
  const addedSec =
    typeof added === "number" ? added : typeof added === "string" && /^\d+$/.test(added) ? Number(added) : null;
  const HIDDEN = new Set(["ref_id", "node_type", "name", "date_added_to_graph"]);
  const props = Object.entries(node).filter(
    ([k, v]) => !HIDDEN.has(k) && v !== null && v !== undefined && v !== "",
  );

  const groups = new Map<string, { name?: string; type?: string; ref?: string }[]>();
  for (const e of edges) {
    const edgeType = asString(e.edge_type) ?? "RELATED";
    const nn = isRecord(e.neighbor_node) ? e.neighbor_node : {};
    groups.set(edgeType, [
      ...(groups.get(edgeType) ?? []),
      { name: asString(nn.name), type: asString(nn.node_type), ref: asString(nn.ref_id) },
    ]);
  }

  return (
    <div className="text-[12.5px] space-y-1">
      {addedSec !== null && (
        <div className="font-mono text-[10.5px] text-muted-foreground/70">
          added to graph {new Date(addedSec * 1000).toISOString().slice(0, 10)}
        </div>
      )}
      {props.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {props.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="font-mono text-[10.5px] text-muted-foreground/70 truncate pt-0.5">{k}</dt>
              <dd className="break-words">{typeof v === "object" ? renderValue(v) : String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {[...groups.entries()].map(([edgeType, neighbors]) => (
        <div key={edgeType}>
          <MiniHeading>
            {edgeType} ({neighbors.length})
          </MiniHeading>
          <div className="flex flex-wrap gap-1">
            {neighbors.slice(0, 24).map((n, i) => (
              <span
                key={`${n.ref ?? i}`}
                title={n.ref ?? undefined}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
              >
                {n.type && <span className="text-muted-foreground/50">{n.type}</span>}
                {n.name ?? (n.ref ? `${n.ref.slice(0, 8)}…` : "unnamed")}
              </span>
            ))}
            {neighbors.length > 24 && (
              <span className="text-[10.5px] text-muted-foreground/60">
                +{neighbors.length - 24} more
              </span>
            )}
          </div>
        </div>
      ))}
      {props.length === 0 && groups.size === 0 && renderValue(payload)}
    </div>
  );
}

/**
 * Concept chips with shared "Prefix: " families collapsed into one labeled
 * cluster so the prefix reads once. Tapping a chip opens a peek dialog;
 * when a workspace slug is available the peek fetches the live node through
 * the same authed route the /learn page uses.
 */
function ConceptStrip({
  concepts,
  workspaceSlug,
}: {
  concepts: ConceptPull[];
  workspaceSlug: string | null;
}) {
  const [peek, setPeek] = useState<{
    c: ConceptPull;
    state: "loading" | "done" | "error";
    payload?: unknown;
    note?: string;
  } | null>(null);

  const openPeek = async (c: ConceptPull) => {
    if (!c.refId) {
      setPeek({ c, state: "error", note: "The run recorded no ref_id for this node." });
      return;
    }
    if (!workspaceSlug) {
      setPeek({ c, state: "error", note: "Live node fetch needs a workspace context." });
      return;
    }
    setPeek({ c, state: "loading" });
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/lingo/nodes/${encodeURIComponent(c.refId)}`,
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setPeek({
          c,
          state: "error",
          note: `Graph lookup failed (${res.status}${json?.error ? `: ${json.error}` : ""}).`,
        });
      } else {
        setPeek({ c, state: "done", payload: json.data });
      }
    } catch {
      setPeek({ c, state: "error", note: "Fetch failed." });
    }
  };

  const top = concepts.slice(0, 8);
  const families = new Map<string, ConceptPull[]>();
  const solo: ConceptPull[] = [];
  for (const c of top) {
    const m = c.name.match(/^(.{3,40}?):\s+(.+)$/);
    if (m) families.set(m[1], [...(families.get(m[1]) ?? []), c]);
    else solo.push(c);
  }
  const chip = (c: ConceptPull, label: string) => (
    <button
      key={c.name}
      type="button"
      onClick={() => openPeek(c)}
      title={c.agents.map((a) => `${a.name} ×${a.count}`).join(" · ")}
      className="inline-flex items-baseline gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      data-testid="run-report-concept-chip"
    >
      {label}
      <b className="font-mono text-[10px] tabular-nums text-foreground/80">×{c.total}</b>
    </button>
  );
  const out: React.ReactNode[] = [];
  for (const [prefix, members] of families) {
    if (members.length < 2) {
      solo.push(...members);
      continue;
    }
    out.push(
      <span
        key={prefix}
        className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border/60 px-1.5 py-1"
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 px-1">
          {prefix}
        </span>
        {members.map((c) => chip(c, c.name.slice(prefix.length + 1).trim()))}
      </span>,
    );
  }
  for (const c of solo.sort((a, b) => b.total - a.total)) out.push(chip(c, c.name));
  out.push(
    <a key="_all" href="#concepts" className="font-mono text-[10.5px] text-primary hover:underline px-1">
      all {concepts.length} ↓
    </a>,
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">{out}</div>
      <Dialog open={peek !== null} onOpenChange={(next) => !next && setPeek(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2 text-[15px]">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
                {peek?.c.nodeType ?? "node"}
              </span>
              {peek?.c.name}
            </DialogTitle>
          </DialogHeader>
          {peek?.c.refId && (
            <div className="font-mono text-[10px] text-muted-foreground/60 -mt-2 truncate">
              ref {peek.c.refId}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {peek?.c.agents.map((a) => (
              <span
                key={a.name}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
              >
                {a.name}
                {a.count > 1 && <b className="tabular-nums">×{a.count}</b>}
              </span>
            ))}
          </div>
          {peek?.state === "loading" && (
            <p className="text-[12.5px] text-muted-foreground italic">fetching from the graph…</p>
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

export function ReportHeader({
  projection,
  chain,
  taskTitle,
  timezone,
  workspaceSlug,
  onOpenDoc,
}: {
  projection: RunReportProjection;
  chain: ChainModel;
  taskTitle: string;
  timezone: string;
  workspaceSlug: string | null;
  onOpenDoc: OpenDoc;
}) {
  const cfg = projection.pageData.config as Record<string, unknown>;
  const slug = asString(cfg.task_slug) ?? "—";
  const goal = asString(cfg.task_goal);
  const runId = asString(cfg.run_id);
  const { stats, generatedAtMs } = projection;
  const allPassed = stats.failCount === 0 && stats.passCount !== null;

  return (
    <header
      className="pb-8 border-b border-border mb-8"
      data-testid="run-report-header"
    >
      <Kicker>Run report</Kicker>
      <h1 className="text-3xl font-semibold tracking-tight">{taskTitle}</h1>
      <div className="flex flex-wrap gap-2 mt-2">
        <Chip label="slug" value={slug} />
        {runId && <Chip label="run" value={runId} />}
        {projection.pageData.wallClockMin !== null && (
          <Chip label="wall clock" value={`${projection.pageData.wallClockMin.toFixed(1)}m`} />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-8 mt-5">
        <div>
          <div className="text-[56px] leading-none font-semibold tracking-tight tabular-nums">
            {stats.passCount ?? "—"}
            <span className="text-2xl text-muted-foreground/60 font-normal"> / {stats.rubricCount}</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 mt-1.5">
            criteria passed
          </div>
        </div>
        <div className="flex-1 min-w-[260px]">
          {stats.passCount !== null && (
            <StatusBadge kind={allPassed ? "pass" : "fail"}>
              {allPassed ? "All criteria passed" : `${stats.failCount} failed`}
            </StatusBadge>
          )}
          {goal && <p className="text-[14px] text-muted-foreground max-w-[72ch] mt-2">{goal}</p>}
          {generatedAtMs !== null && (
            <div className="font-mono text-[10px] text-muted-foreground/60 mt-2">
              Generated {formatInUserTz(new Date(generatedAtMs), timezone)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-x-10 gap-y-3 md:grid-cols-[auto_minmax(0,1fr)] items-start">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mb-1.5">
            Deliverable
          </div>
          {chain.deliverables.length === 0 && (
            <p className="text-[12px] text-muted-foreground italic max-w-[32ch]">
              {chain.criteria[0]?.hops[0]?.answer ?? "No deliverable identified."}
            </p>
          )}
          {chain.deliverables.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpenDoc(d.id, [])}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 font-mono text-[11.5px] hover:border-amber-500 transition-colors"
            >
              ★ {d.title.replace(/^FINAL DELIVERABLE - /, "")}
            </button>
          ))}
        </div>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mb-1.5">
            Input documents ({chain.inputDocs.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {chain.inputDocs.map((d) => {
              const ext = d.title.includes(".") ? d.title.split(".").pop()! : "";
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenDoc(d.id, [])}
                  className="group inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                  data-testid="run-report-doc-link"
                >
                  {ext && (
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground/50 border border-border/70 rounded-sm px-1 group-hover:text-muted-foreground">
                      {ext}
                    </span>
                  )}
                  {d.title.replace(/\.[^.]+$/, "")}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mb-1.5">
          Concepts read{" "}
          <span className="normal-case tracking-normal">
            — top {Math.min(8, chain.topConcepts.length)} of {chain.topConcepts.length} opened via
            graph_get
            {chain.conceptsSurfacedOnly > 0 &&
              ` · ${chain.conceptsSurfacedOnly} surfaced in search but never read`}
          </span>
        </div>
        {chain.conceptsGap ? (
          <p className="text-[12px] text-muted-foreground italic">{chain.conceptsGap}</p>
        ) : (
          <ConceptStrip concepts={chain.topConcepts} workspaceSlug={workspaceSlug} />
        )}
      </div>
    </header>
  );
}
