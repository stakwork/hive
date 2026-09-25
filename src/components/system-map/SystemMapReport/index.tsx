"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  HelpCircle,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildTypeTree,
  filterTypeTree,
  groupEdges,
  nodeMatchesFilter,
  verdictSegments,
  VERDICTS,
  type EdgeGroup,
  type ReportEdge,
  type ReportFilter,
  type SystemMapReport as Report,
  type TypeTreeNode,
  type Verdict,
  type VerdictCounts,
} from "./model";

/**
 * Verdicts are STATUS colors: each carries an icon and a label, never color
 * alone. MATCH = good, PARTIAL = warning, CONFLICT = critical; MISSING is a
 * neutral absence (most of any report) and UNKNOWN a "needs a look".
 */
const VERDICT_STYLE: Record<
  Verdict,
  { label: string; icon: LucideIcon; text: string; fill: string; ring: string; tile: string }
> = {
  MATCH: {
    label: "Match",
    icon: CheckCircle2,
    text: "text-emerald-700 dark:text-emerald-400",
    fill: "bg-emerald-500 dark:bg-emerald-400",
    ring: "ring-emerald-500/60",
    tile: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  PARTIAL: {
    label: "Partial",
    icon: CircleDot,
    text: "text-amber-700 dark:text-amber-400",
    fill: "bg-amber-500 dark:bg-amber-400",
    ring: "ring-amber-500/60",
    tile: "bg-amber-50 dark:bg-amber-950/40",
  },
  MISSING: {
    label: "Missing",
    icon: Circle,
    text: "text-slate-500 dark:text-slate-400",
    fill: "bg-slate-300 dark:bg-slate-600",
    ring: "ring-slate-400/60",
    tile: "bg-slate-50 dark:bg-slate-900/60",
  },
  UNKNOWN: {
    label: "Unknown",
    icon: HelpCircle,
    text: "text-sky-700 dark:text-sky-400",
    fill: "bg-sky-500 dark:bg-sky-400",
    ring: "ring-sky-500/60",
    tile: "bg-sky-50 dark:bg-sky-950/40",
  },
  CONFLICT: {
    label: "Conflict",
    icon: AlertTriangle,
    text: "text-rose-700 dark:text-rose-400",
    fill: "bg-rose-500 dark:bg-rose-400",
    ring: "ring-rose-500/60",
    tile: "bg-rose-50 dark:bg-rose-950/40",
  },
};

function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", style.text, className)}
      data-testid={`verdict-${verdict.toLowerCase()}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {style.label}
    </span>
  );
}

/** Segmented share bar: one fill per verdict, 2px surface gaps, fixed order. */
function VerdictBar({ counts, className }: { counts: VerdictCounts; className?: string }) {
  const segments = verdictSegments(counts);
  if (segments.length === 0) return null;
  const title = segments.map((s) => `${VERDICT_STYLE[s.verdict].label} ${s.count}`).join(" · ");
  return (
    <div className={cn("flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full", className)} title={title} aria-label={title}>
      {segments.map((s) => (
        <div
          key={s.verdict}
          className={cn("h-full rounded-full", VERDICT_STYLE[s.verdict].fill)}
          style={{ width: `${s.share * 100}%` }}
        />
      ))}
    </div>
  );
}

function CountChips({ counts }: { counts: VerdictCounts }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {VERDICTS.filter((v) => counts[v] > 0).map((v) => {
        const Icon = VERDICT_STYLE[v].icon;
        return (
          <span key={v} className="inline-flex items-center gap-1">
            <Icon className={cn("h-3 w-3", VERDICT_STYLE[v].text)} aria-hidden />
            {counts[v]}
          </span>
        );
      })}
    </span>
  );
}

function StatTile({
  verdict,
  count,
  active,
  onToggle,
}: {
  verdict: Verdict;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
        style.tile,
        active ? cn("ring-2", style.ring) : "hover:border-foreground/30",
      )}
      data-testid={`system-map-tile-${verdict.toLowerCase()}`}
    >
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", style.text)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {style.label}
      </span>
      <span className="text-2xl font-semibold leading-none text-foreground">{count}</span>
    </button>
  );
}

function Evidence({ lines, reason }: { lines: string[]; reason: string | null }) {
  if (lines.length === 0 && !reason) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {reason && <p className="italic">{reason}</p>}
      {lines.map((line, i) => (
        <p key={i} className="break-words font-mono text-[11px] leading-snug">
          {line}
        </p>
      ))}
    </div>
  );
}

function TypeRow({ node, depth, filter }: { node: TypeTreeNode; depth: number; filter: ReportFilter }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const self = nodeMatchesFilter(node.item, filter);
  const showDetails = node.item.evidence.length > 0 || node.item.reason;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div>
      <div
        className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50", !self && "opacity-50")}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        data-testid="system-map-type-row"
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => showDetails && setDetailsOpen((o) => !o)}
              className={cn("truncate font-mono text-sm", showDetails && "cursor-pointer hover:underline")}
              title={node.item.type}
            >
              {node.item.type}
            </button>
            <VerdictBadge verdict={node.item.verdict} />
            {hasChildren && <CountChips counts={node.counts} />}
          </div>
          {detailsOpen && <Evidence lines={node.item.evidence} reason={node.item.reason} />}
        </div>
      </div>
      {open &&
        node.children.map((child) => <TypeRow key={child.item.type} node={child} depth={depth + 1} filter={filter} />)}
    </div>
  );
}

function EdgeRow({ edge }: { edge: ReportEdge }) {
  const [open, setOpen] = useState(false);
  const showDetails = edge.evidence.length > 0 || edge.reason;
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-muted/50" data-testid="system-map-edge-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => showDetails && setOpen((o) => !o)}
          className={cn("font-mono text-sm", showDetails && "cursor-pointer hover:underline")}
        >
          {edge.source_type}
          <span className="mx-1.5 text-muted-foreground">→</span>
          {edge.target_type}
        </button>
        <VerdictBadge verdict={edge.verdict} />
      </div>
      {open && <Evidence lines={edge.evidence} reason={edge.reason} />}
    </div>
  );
}

function EdgeGroupSection({ group, defaultOpen }: { group: EdgeGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border" data-testid="system-map-edge-group">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="font-mono text-sm font-medium">{group.edgeType}</span>
        <span className="text-xs text-muted-foreground">{group.edges.length}</span>
        <div className="ml-auto flex w-40 max-w-[40%] items-center gap-3">
          <VerdictBar counts={group.counts} />
        </div>
      </button>
      {open && (
        <div className="border-t px-1 py-1">
          {group.edges.map((edge, i) => (
            <EdgeRow key={`${edge.source_type}-${edge.target_type}-${i}`} edge={edge} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemMapReport({ report }: { report: Report }) {
  const [verdicts, setVerdicts] = useState<Set<Verdict>>(new Set());
  const [query, setQuery] = useState("");
  const filter = useMemo<ReportFilter>(() => ({ verdicts, query: query.trim() }), [verdicts, query]);

  const tree = useMemo(() => buildTypeTree(report.nodeTypes), [report.nodeTypes]);
  const visibleTree = useMemo(() => filterTypeTree(tree, filter), [tree, filter]);
  const edgeGroups = useMemo(() => groupEdges(report.edges, filter), [report.edges, filter]);
  const allEdgeGroups = useMemo(() => groupEdges(report.edges), [report.edges]);

  const typeCounts = useMemo(() => {
    const c = { MATCH: 0, PARTIAL: 0, MISSING: 0, UNKNOWN: 0, CONFLICT: 0 };
    for (const t of report.nodeTypes) c[t.verdict]++;
    return c;
  }, [report.nodeTypes]);
  const edgeCounts = useMemo(() => {
    const c = { MATCH: 0, PARTIAL: 0, MISSING: 0, UNKNOWN: 0, CONFLICT: 0 };
    for (const e of report.edges) c[e.verdict]++;
    return c;
  }, [report.edges]);

  const toggleVerdict = (v: Verdict) =>
    setVerdicts((current) => {
      const next = new Set(current);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const visibleTypeCount = visibleTree.reduce((n, node) => n + VERDICTS.reduce((m, v) => m + node.counts[v], 0), 0);
  const visibleEdgeCount = edgeGroups.reduce((n, g) => n + g.edges.length, 0);
  const filtering = verdicts.size > 0 || filter.query.length > 0;

  return (
    <div className="space-y-4" data-testid="system-map-report">
      {/* KPI row: one tile per verdict, click to filter. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {VERDICTS.map((v) => (
          <StatTile
            key={v}
            verdict={v}
            count={report.summary.counts[v]}
            active={verdicts.has(v)}
            onToggle={() => toggleVerdict(v)}
          />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Node types</span>
            <span>{report.nodeTypes.length}</span>
          </div>
          <VerdictBar counts={typeCounts} />
        </div>
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Edges</span>
            <span>{report.edges.length}</span>
          </div>
          <VerdictBar counts={edgeCounts} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter types, edges or evidence"
            className="pl-8"
            data-testid="system-map-report-search"
          />
        </div>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setVerdicts(new Set());
              setQuery("");
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
        <p className="ml-auto text-xs text-muted-foreground" data-testid="system-map-report-count">
          {visibleTypeCount} of {report.nodeTypes.length} types · {visibleEdgeCount} of {report.edges.length} edges
        </p>
      </div>

      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Node types</TabsTrigger>
          <TabsTrigger value="edges">Edges</TabsTrigger>
        </TabsList>
        <TabsContent value="types" className="mt-3">
          {visibleTree.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">No node types match the current filter.</p>
          ) : (
            <div className="rounded-lg border py-1">
              {visibleTree.map((node) => (
                <TypeRow key={node.item.type} node={node} depth={0} filter={filter} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="edges" className="mt-3 space-y-2">
          {edgeGroups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">No edges match the current filter.</p>
          ) : (
            edgeGroups.map((group) => (
              <EdgeGroupSection
                key={group.edgeType}
                group={group}
                // The hierarchy relation mirrors the type tree and dominates
                // the count; keep it folded unless it is the only group left.
                defaultOpen={group.edgeType !== "CHILD_OF" || allEdgeGroups.length === 1 || filtering}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">About this run</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {report.ontologyVersion && (
            <>
              <dt>Ontology</dt>
              <dd className="font-mono">
                {report.ontologyVersion.hash ? report.ontologyVersion.hash.slice(0, 12) : "—"}
                {report.ontologyVersion.typeCount !== null && ` · ${report.ontologyVersion.typeCount} types`}
                {report.ontologyVersion.edgeCount !== null && ` · ${report.ontologyVersion.edgeCount} edges`}
              </dd>
            </>
          )}
          {report.swarmUrl && (
            <>
              <dt>Swarm</dt>
              <dd className="font-mono">{report.swarmUrl}</dd>
            </>
          )}
          {report.sessionId && (
            <>
              <dt>Session</dt>
              <dd className="font-mono">{report.sessionId}</dd>
            </>
          )}
          {report.note && (
            <>
              <dt>Note</dt>
              <dd>{report.note}</dd>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
