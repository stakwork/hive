"use client";

import React, { useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { WorkflowStatus } from "@prisma/client";
import { Chip, StatusBadge } from "@/components/run-report/chrome";
import { PillSection } from "@/components/legal/PillSection";
import { CascadeHeader } from "@/components/legal/CascadeHeader";
import {
  buildViewRows,
  viewRowLane,
  pillKey,
  formatTokens,
  shortSessionId,
  CascadeRowItem,
  ROW_H,
  TOP_PAD,
  LANE_X,
  LANE_TEXT,
  LANE_STROKE,
  MIN_W,
  type ViewRow,
} from "@/components/legal/CascadeRow";
import { useRunCascade } from "@/hooks/useRunCascade";
import type {
  AgentCascade,
  CascadeSessionStatus,
  RunCascadeModel,
} from "@/lib/legal-cascade/types";

/**
 * The session cascade: the entire agent stack of one benchmark run — every
 * top-level agent in sequence, each agent's sub-agent tree, and every Concept
 * action — live while the run executes and identically after it finishes.
 *
 * Rendering mirrors the mockup's DOM 1:1: absolutely-positioned 34px rows
 * over one SVG per agent section carrying the lane spines and fork/merge
 * beziers.
 */

function statusBadgeKind(status: CascadeSessionStatus): "pass" | "fail" | "warn" | "muted" {
  switch (status) {
    case "success":
      return "pass";
    case "error":
      return "fail";
    case "running":
      return "warn";
    default:
      return "muted";
  }
}

function groupByBatch(agents: AgentCascade[]): AgentCascade[][] {
  const batches: AgentCascade[][] = [];
  for (const agent of agents) {
    const last = batches[batches.length - 1];
    if (last && last[0].batchIndex === agent.batchIndex) last.push(agent);
    else batches.push([agent]);
  }
  return batches;
}

function runStartMs(model: RunCascadeModel): number | null {
  let min = Infinity;
  for (const agent of model.agents) {
    const t = Date.parse(agent.session.timestamp);
    if (!Number.isNaN(t) && t > 0) min = Math.min(min, t);
    for (const row of agent.rows) {
      if (row.timestamp != null) min = Math.min(min, row.timestamp);
    }
  }
  return Number.isFinite(min) ? min : null;
}

// ── Lane spines + fork/merge curves for one agent section ────────────────────

function SectionSvg({
  viewRows,
  height,
  live,
}: {
  viewRows: ViewRow[];
  height: number;
  live: boolean;
}) {
  const y = (i: number) => TOP_PAD + i * ROW_H + ROW_H / 2;
  const lanes = viewRows.map(viewRowLane);

  // Contiguous same-lane segments; dashed hand-off to the next segment on the
  // same lane (the mockup's between-segment style).
  const segments: { lane: number; start: number; end: number }[] = [];
  lanes.forEach((lane, i) => {
    const last = segments[segments.length - 1];
    if (last && last.lane === lane && last.end === i - 1) last.end = i;
    else segments.push({ lane, start: i, end: i });
  });

  const elements: ReactNode[] = [];
  segments.forEach((seg, gi) => {
    const x = LANE_X[seg.lane];
    elements.push(
      <line
        key={`seg-${gi}`}
        x1={x}
        y1={y(seg.start)}
        x2={x}
        y2={y(seg.end)}
        strokeWidth={2}
        className={LANE_STROKE[seg.lane]}
      />,
    );
    for (let gj = gi + 1; gj < segments.length; gj++) {
      if (segments[gj].lane === seg.lane) {
        elements.push(
          <line
            key={`dash-${gi}`}
            x1={x}
            y1={y(seg.end)}
            x2={x}
            y2={y(segments[gj].start)}
            strokeWidth={1.5}
            strokeDasharray="2 5"
            opacity={0.45}
            className={LANE_STROKE[seg.lane]}
          />,
        );
        break;
      }
    }
  });

  viewRows.forEach((vr, i) => {
    if (vr.type !== "model") return;
    const row = vr.row;
    const lane = lanes[i];
    // Fork: curve from the previous row's lane into the agent header.
    if (row.kind === "agent" && i > 0) {
      const xp = LANE_X[lanes[i - 1]];
      const xc = LANE_X[lane];
      elements.push(
        <path
          key={`fork-${i}`}
          d={`M${xp} ${y(i - 1)} C ${xp} ${y(i - 1) + ROW_H * 0.7}, ${xc} ${y(i) - ROW_H * 0.7}, ${xc} ${y(i)}`}
          fill="none"
          strokeWidth={2}
          className={LANE_STROKE[lane]}
        />,
      );
    }
    // Merge: the child's final response curves back to the next row's lane.
    if (row.kind === "response" && row.merge && i + 1 < viewRows.length) {
      const xm = LANE_X[lane];
      const xr = LANE_X[lanes[i + 1]];
      elements.push(
        <path
          key={`merge-${i}`}
          d={`M${xm} ${y(i)} C ${xm} ${y(i) + ROW_H * 0.7}, ${xr} ${y(i + 1) - ROW_H * 0.7}, ${xr} ${y(i + 1)}`}
          fill="none"
          strokeWidth={2}
          className={LANE_STROKE[lane]}
        />,
      );
    }
  });

  // Live head: the lane-0 spine trails past the last row toward the pulsing dot.
  if (live && viewRows.length > 0) {
    const lastY = y(viewRows.length - 1);
    elements.push(
      <line
        key="head-trail"
        x1={LANE_X[0]}
        y1={lastY}
        x2={LANE_X[0]}
        y2={lastY + ROW_H * 0.8}
        strokeWidth={2}
        opacity={0.6}
        className={LANE_STROKE[0]}
      />,
    );
  }

  return (
    <svg
      width="100%"
      height={height}
      className="pointer-events-none absolute inset-0 overflow-visible"
      aria-hidden
    >
      {elements}
    </svg>
  );
}

// ── One top-level agent's cascade ────────────────────────────────────────────

function AgentSection({
  agent,
  startMs,
  expandedPills,
  openPrompts,
  onTogglePill,
  onToggleAgent,
}: {
  agent: AgentCascade;
  startMs: number | null;
  expandedPills: ReadonlySet<string>;
  openPrompts: ReadonlySet<string>;
  onTogglePill: (key: string) => void;
  onToggleAgent: (key: string) => void;
}) {
  const { session } = agent;
  const viewRows = useMemo(
    () => buildViewRows(agent.rows, expandedPills, openPrompts),
    [agent.rows, expandedPills, openPrompts],
  );
  const height = TOP_PAD + viewRows.length * ROW_H + (agent.live ? 40 : 8);

  return (
    <section data-testid={`cascade-agent-${session.id}`}>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-1 pb-1 pt-3">
        <span
          className={`font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] ${LANE_TEXT[0]}`}
        >
          {session.agent_name || session.id}
        </span>
        <StatusBadge kind={statusBadgeKind(session.status)}>{session.status}</StatusBadge>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          · {shortSessionId(session.id)}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <Chip label="turns" value={session.turn_count} />
          {session.token_usage && (
            <Chip label="tok" value={formatTokens(session.token_usage.total)} />
          )}
          {session.model && <Chip label="model" value={session.model} />}
        </span>
      </div>

      {viewRows.length === 0 ? (
        <p className="px-1 py-3 font-mono text-[11px] italic text-muted-foreground">
          no trace recorded for this session
        </p>
      ) : (
        <div className="relative" style={{ height }}>
          <SectionSvg viewRows={viewRows} height={height} live={agent.live} />
          {viewRows.map((vr, i) => (
            <CascadeRowItem
              key={vr.key}
              vr={vr}
              index={i}
              runStartMs={startMs}
              expandedPills={expandedPills}
              openPrompts={openPrompts}
              onTogglePill={onTogglePill}
              onToggleAgent={onToggleAgent}
            />
          ))}
          {agent.live && (
            <div
              className="absolute h-2.5 w-2.5 rounded-full bg-cyan-600 dark:bg-cyan-400 motion-safe:animate-pulse"
              style={{
                left: LANE_X[0] - 5,
                top: TOP_PAD + (viewRows.length - 1) * ROW_H + ROW_H / 2 + ROW_H * 0.8 - 5,
              }}
              data-testid={`cascade-live-head-${session.id}`}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ── The full trace (pure — takes an assembled model) ─────────────────────────

export function CascadeTrace({ model }: { model: RunCascadeModel }) {
  const [expandedPills, setExpandedPills] = useState<ReadonlySet<string>>(new Set());
  const [openPrompts, setOpenPrompts] = useState<ReadonlySet<string>>(new Set());

  const startMs = useMemo(() => runStartMs(model), [model]);
  const allPillKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const agent of model.agents) {
      for (const row of agent.rows) if (row.kind === "pill") keys.add(pillKey(row));
    }
    return keys;
  }, [model]);
  const allExpanded = allPillKeys.size > 0 && expandedPills.size >= allPillKeys.size;

  const togglePill = (key: string) =>
    setExpandedPills((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAgent = (key: string) =>
    setOpenPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div data-testid="run-cascade-trace">
      <CascadeHeader
        summary={model.summary}
        allExpanded={allExpanded}
        onToggleExpandAll={() =>
          setExpandedPills(allExpanded ? new Set() : new Set(allPillKeys))
        }
      />
      <div className="overflow-x-auto px-4 pb-4">
        <div className="space-y-1" style={{ minWidth: MIN_W }}>
          {groupByBatch(model.agents).map((batch, bi) => {
            const sections = batch.map((agent) => (
              <AgentSection
                key={agent.session.id}
                agent={agent}
                startMs={startMs}
                expandedPills={expandedPills}
                openPrompts={openPrompts}
                onTogglePill={togglePill}
                onToggleAgent={toggleAgent}
              />
            ));
            // Agents launch in parallel batches, not sequentially — a batch's
            // members are siblings (concurrent lanes), not a chain.
            if (batch.length === 1) return sections;
            return (
              <div
                key={`batch-${bi}`}
                className="border-l-2 border-dashed border-border pl-2"
                data-testid={`cascade-batch-${bi}`}
              >
                <div className="px-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  ∥ parallel ×{batch.length}
                </div>
                {sections}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Pill + panel wired to the polling hook ───────────────────────────────────

interface BenchmarkRunCascadeProps {
  runId: string;
  /** The StakworkRun's workflow status — keeps the trace polling for new
   *  agents while the run is active. */
  runStatus?: WorkflowStatus | string;
}

/**
 * "Traces" in the expanded run row: a small pill that pops in once the run's
 * agent sessions exist, expanding into the full cascade panel on click. The
 * heavyweight protocol (session details + turn chains) only runs while the
 * panel is open.
 */
export function BenchmarkRunCascade({ runId, runStatus }: BenchmarkRunCascadeProps) {
  const [open, setOpen] = useState(false);
  const { sessions, model, error, isLive } = useRunCascade(runId, {
    enabled: open,
    runStatus,
  });

  // The pill pops in only once a trace exists — legacy runs with no sessions
  // show nothing at all.
  if (sessions.length === 0) return null;

  return (
    <PillSection
      testId="run-cascade"
      open={open}
      onOpenChange={setOpen}
      label={
        <>
          Traces{" "}
          <span className="font-normal text-muted-foreground">
            ({sessions.length} agent{sessions.length !== 1 ? "s" : ""})
          </span>
          {isLive && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          )}
        </>
      }
    >
      {error ? (
        <p className="px-4 py-6 text-center text-sm text-destructive">
          Failed to load trace: {error}
        </p>
      ) : !model ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading trace…</span>
        </div>
      ) : model.agents.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No agent sessions recorded for this run.
        </p>
      ) : (
        <CascadeTrace model={model} />
      )}
    </PillSection>
  );
}
