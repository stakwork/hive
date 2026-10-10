/**
 * Strut run events → the run's graph calls. Pure.
 *
 * Raw events never leave the server: a step's `input` and `output` can hold
 * anything the workflow handled (a benchmark's answer key, a secret-shaped
 * string), so a call keeps only its path, its timing, the nodes it touched,
 * and the allowlisted scalar fields of what it asked for.
 *
 * A search touched nothing: what it matched is counted (`hits`), not kept.
 */

import { isPeerSlug, qualifyRef } from "./peer-ref";
import type { RunGraphAccess, RunGraphCall, RunGraphNodeRef, RunGraphQueryValue } from "./types";

const TOOL_PREFIX = "tool:";

/** The query fields a call may show. Node payloads (`node_data`, `triplets`, …) are not among them. */
const QUERY_KEYS = [
  "ref_id",
  "ref_ids",
  "query",
  "q",
  "node_type",
  "node_types",
  "name",
  "namespace",
  "edge_type",
  "edge_types",
  "direction",
  "children",
  "depth",
  "limit",
  "source_ref_id",
  "target_ref_id",
] as const;

const MAX_QUERY_STRING = 300;
const MAX_QUERY_LIST = 50;

const WRITE_RE = /(^|[/_-])(create|edit|update|delete|remove|write|merge|upsert|register)([/_-]|$)/;

export function accessOf(tool: string): RunGraphAccess {
  return WRITE_RE.test(tool.toLowerCase()) ? "write" : "read";
}

const SEARCH_RE = /(^|[/_-])search([/_-]|$)/;

/** A search answers with what matched its query, whether or not the run went on to read it. */
export function isSearch(tool: string): boolean {
  return accessOf(tool) === "read" && SEARCH_RE.test(tool.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string): string {
  return value.length > MAX_QUERY_STRING ? `${value.slice(0, MAX_QUERY_STRING)}…` : value;
}

function toQueryValue(value: unknown): RunGraphQueryValue | undefined {
  if (typeof value === "string") return value ? clip(value) : undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const list = value.filter((v): v is string => typeof v === "string" && v.length > 0).map(clip);
    return list.length > 0 ? list.slice(0, MAX_QUERY_LIST) : undefined;
  }
  return undefined;
}

/** A tool call's input reaches the log as an object, or as JSON text when strut truncated it. */
function queryOf(input: unknown): Record<string, RunGraphQueryValue> {
  let record: unknown = input;
  if (typeof input === "string") {
    try {
      record = JSON.parse(input);
    } catch {
      return {};
    }
  }
  if (!isRecord(record)) return {};
  const query: Record<string, RunGraphQueryValue> = {};
  for (const key of QUERY_KEYS) {
    const value = toQueryValue(record[key]);
    if (value !== undefined) query[key] = value;
  }
  return query;
}

/**
 * A ref tagged `peer` names a node in ANOTHER workspace's graph — a
 * `strut/run-workflow` step folds the peer run's nodes onto its own
 * `step.end` (strut plans/federation.md §2.2), tagged with the peer's id,
 * the workspace's slug. It is kept under a qualified id (`peer-ref.ts`) and
 * resolved against that workspace's graph, never this one. A tag that is not
 * a slug is not a ref this trace can place, so it is dropped.
 */
function nodesOf(value: unknown, home?: string): RunGraphNodeRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const nodes: RunGraphNodeRef[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.ref_id !== "string" || !item.ref_id) continue;
    const tagged = typeof item.peer === "string" && item.peer.trim() !== "";
    // An untagged ref in a peer's own run is in that peer's graph.
    const peer = tagged ? (item.peer as string).trim() : home;
    if (tagged && !isPeerSlug(peer)) continue;
    const id = qualifyRef(item.ref_id, peer);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({
      ref_id: id,
      ...(typeof item.node_type === "string" && item.node_type ? { node_type: item.node_type } : {}),
      ...(peer ? { peer } : {}),
    });
  }
  return nodes;
}

/** The steps that launch a workflow as a run of its own, by their names as a step or as an agent's tool. */
const LAUNCHERS: Record<string, "local" | "peer"> = { meta_run_workflow: "local", strut_run_workflow: "peer" };

/** Strut's run ids are millisecond timestamps; a workflow name is a path-safe name. Nothing else is ever sent upstream. */
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WORKFLOW_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** A field of a step's input or output: an object, or JSON text — whole, or cut short by strut's log truncation. */
function fieldOf(value: unknown, key: string): string | undefined {
  let record: unknown = value;
  if (typeof value === "string") {
    try {
      record = JSON.parse(value);
    } catch {
      const m = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*)"`).exec(value);
      return m ? m[1] : undefined;
    }
  }
  const field = isRecord(record) ? record[key] : undefined;
  return typeof field === "string" && field ? field : undefined;
}

/** The run a launching call started — from its input (`name`, or `workflow` + `peer`) and its output (`runId`). */
export interface RunGraphLaunch {
  workflow: string;
  runId: string;
  peer?: string;
}

function launchOf(tool: string, input: unknown, output: unknown): RunGraphLaunch | null {
  const kind = LAUNCHERS[tool.replace(/[/-]/g, "_")];
  if (!kind) return null;
  const runId = fieldOf(output, "runId");
  const workflow =
    kind === "local" ? fieldOf(input, "name") : (fieldOf(output, "workflow") ?? fieldOf(input, "workflow"));
  const peer = kind === "peer" ? (fieldOf(output, "peer") ?? fieldOf(input, "peer")) : undefined;
  if (!runId || !RUN_ID_RE.test(runId) || !workflow || !WORKFLOW_RE.test(workflow)) return null;
  if (kind === "peer" && !isPeerSlug(peer)) return null;
  return { workflow, runId, ...(peer ? { peer } : {}) };
}

export interface ProjectOptions {
  /** Put every path under this one: the launching call's, for a child run's calls. */
  prefix?: string;
  /** The peer workspace whose strut ran these events: an untagged ref is in its graph. */
  peer?: string;
}

/** Every call that touched the graph, in the order the run finished them. */
export function projectRunGraphCalls(events: unknown, options: ProjectOptions = {}): RunGraphCall[] {
  return projectWithLaunches(events, options).calls;
}

/**
 * The calls, and for each launching call (by its path, as returned) the run
 * it started — server-side only: a run id never reaches the browser.
 */
export function projectWithLaunches(
  events: unknown,
  options: ProjectOptions = {},
): { calls: RunGraphCall[]; launches: Map<string, RunGraphLaunch> } {
  const launches = new Map<string, RunGraphLaunch>();
  if (!Array.isArray(events)) return { calls: [], launches };
  const starts = new Map<string, { ts: string | null; input: unknown }>();
  const calls: RunGraphCall[] = [];
  for (const event of events) {
    if (!isRecord(event) || typeof event.path !== "string") continue;
    if (event.type === "step.start") {
      starts.set(event.path, { ts: typeof event.ts === "string" ? event.ts : null, input: event.input });
      continue;
    }
    if (event.type !== "step.end") continue;
    const nodes = nodesOf(event.nodes, options.peer);
    if (nodes.length === 0) continue;
    const stepType = typeof event.stepType === "string" ? event.stepType : "";
    const byAgent = stepType.startsWith(TOOL_PREFIX);
    const tool = byAgent ? stepType.slice(TOOL_PREFIX.length) : stepType;
    const start = starts.get(event.path);
    const search = isSearch(tool);
    const path = options.prefix ? `${options.prefix}/${event.path}` : event.path;
    const launch = launchOf(tool, start?.input, event.output);
    if (launch) launches.set(path, launch);
    calls.push({
      path,
      tool,
      by: byAgent ? "agent" : "workflow",
      access: accessOf(tool),
      startedAt: start?.ts ?? null,
      endedAt: typeof event.ts === "string" ? event.ts : null,
      durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
      query: queryOf(start?.input),
      nodes: search ? [] : nodes,
      ...(search ? { hits: nodes.length } : {}),
      ...(launch ? { child: { workflow: launch.workflow, ...(launch.peer ? { peer: launch.peer } : {}) } } : {}),
    });
  }
  return { calls, launches };
}

/** The distinct nodes a list of calls read or wrote, first touch first. A later ref's type fills an earlier untyped one. */
export function distinctNodeRefs(calls: RunGraphCall[]): RunGraphNodeRef[] {
  const byRef = new Map<string, RunGraphNodeRef>();
  for (const call of calls) {
    for (const node of call.nodes) {
      const known = byRef.get(node.ref_id);
      if (!known) byRef.set(node.ref_id, { ...node });
      else if (!known.node_type && node.node_type) known.node_type = node.node_type;
    }
  }
  return [...byRef.values()];
}
