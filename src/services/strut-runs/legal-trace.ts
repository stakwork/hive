/**
 * The legal Traces view for a `harvey-lab-run` run (strut legal workspaces):
 * the cascade's three reads — the run's top-level agents, one agent's
 * sub-agents, one agent's turns — answered from the run's strut event log
 * (`lib/legal-cascade/strut`) instead of stakgraph's sessions API.
 *
 * The log is read once per run and cached briefly (a live run's hook polls
 * every 15 s and asks for each changed agent in turn); a finished agent's
 * reasoning is read from its transcript once and kept.
 */

import { NextRequest, NextResponse } from "next/server";
import { StrutRunStatus } from "@prisma/client";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import {
  buildStrutTrace,
  descendantsOf,
  reasoningByCall,
  topSessions,
  withReasoning,
  type StrutRunEvent,
  type StrutTrace,
} from "@/lib/legal-cascade/strut";
import type { CascadeSession, CascadeSessionDetail, CascadeTurnsPage } from "@/lib/legal-cascade/types";
import type { StrutRunRow } from "@/services/strut-runs";
import { fetchStrutRunEvents, fetchStrutTranscript } from "@/services/strut-runs/lab";
import { HARVEY_LAB_BENCHMARK_SLUG, findLegalStrutRunRow } from "@/services/strut-runs/legal-benchmark";

/** A live run's log is re-read at most this often. */
const LIVE_TTL_MS = 10_000;
/** A settled run's log does not change. */
const SETTLED_TTL_MS = 10 * 60_000;
const MAX_TRACES = 20;
const MAX_REASONING = 300;

const traces = new Map<string, { at: number; trace: StrutTrace }>();
const reasoning = new Map<string, Map<string, string>>();

function remember<V>(cache: Map<string, V>, key: string, value: V, max: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) cache.delete(cache.keys().next().value as string);
}

/** For tests. */
export function clearStrutTraceCache() {
  traces.clear();
  reasoning.clear();
}

/** The run's agents, from its log; null when strut could not answer. */
export async function readStrutTrace(row: StrutRunRow, now = Date.now()): Promise<StrutTrace | null> {
  const hit = traces.get(row.id);
  const ttl = row.status === StrutRunStatus.PENDING ? LIVE_TTL_MS : SETTLED_TTL_MS;
  if (hit && now - hit.at < ttl) return hit.trace;
  const events = (await fetchStrutRunEvents(row)) as StrutRunEvent[] | null;
  if (!events) return null;
  const runFinished =
    row.status !== StrutRunStatus.PENDING || events.some((e) => e.type === "run.end" || e.type === "run.error");
  const trace = buildStrutTrace(events, row.workflow, runFinished);
  remember(traces, row.id, { at: now, trace }, MAX_TRACES);
  return trace;
}

export async function strutTraceSessions(row: StrutRunRow): Promise<CascadeSession[] | null> {
  const trace = await readStrutTrace(row);
  return trace ? topSessions(trace) : null;
}

export async function strutTraceSessionDetail(row: StrutRunRow, sessionId: string): Promise<CascadeSessionDetail | null> {
  const trace = await readStrutTrace(row);
  const s = trace?.sessions.get(sessionId);
  if (!trace || !s) return null;
  return { ...s.session, descendants: descendantsOf(trace, sessionId) };
}

/**
 * One agent's turns after `after`. A finished agent's chain is sent whole,
 * with its reasoning: the reasoning sits in slots below the cursor a live
 * read already passed.
 */
export async function strutTraceTurns(
  row: StrutRunRow,
  sessionId: string,
  after: number,
): Promise<CascadeTurnsPage | null> {
  const trace = await readStrutTrace(row);
  const s = trace?.sessions.get(sessionId);
  if (!s) return null;
  let turns = s.turns;
  if (s.finished && s.transcript) {
    const key = `${row.id}|${sessionId}`;
    let byCall = reasoning.get(key);
    if (!byCall) {
      const messages = await fetchStrutTranscript(row, s.transcript);
      if (messages) {
        byCall = reasoningByCall(messages);
        remember(reasoning, key, byCall, MAX_REASONING);
      }
    }
    if (byCall) turns = withReasoning(turns, byCall);
  }
  return {
    session_id: s.session.id,
    status: s.session.status,
    turn_count: s.session.turn_count,
    last_turn_at: s.session.last_turn_at,
    turns: s.finished ? turns : turns.filter((t) => t.order > after),
  };
}

/** The routes' gate: the `harvey-lab` benchmark in this workspace, and the run by its hive id. */
export async function resolveStrutTraceRow(
  request: NextRequest,
  slug: string,
): Promise<StrutRunRow | NextResponse> {
  const auth = await authorizeBenchmark(request, slug, HARVEY_LAB_BENCHMARK_SLUG);
  if (auth instanceof NextResponse) return auth;
  const runId = request.nextUrl.searchParams.get("runId")?.trim();
  if (!runId) return NextResponse.json({ error: "runId query param is required" }, { status: 400 });
  const row = await findLegalStrutRunRow(auth.member.workspaceId, runId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return row;
}
