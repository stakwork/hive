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
function nodesOf(value: unknown): RunGraphNodeRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const nodes: RunGraphNodeRef[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.ref_id !== "string" || !item.ref_id) continue;
    const tagged = typeof item.peer === "string" && item.peer.trim() !== "";
    const peer = tagged ? (item.peer as string).trim() : undefined;
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

/** Every call that touched the graph, in the order the run finished them. */
export function projectRunGraphCalls(events: unknown): RunGraphCall[] {
  if (!Array.isArray(events)) return [];
  const starts = new Map<string, { ts: string | null; input: unknown }>();
  const calls: RunGraphCall[] = [];
  for (const event of events) {
    if (!isRecord(event) || typeof event.path !== "string") continue;
    if (event.type === "step.start") {
      starts.set(event.path, { ts: typeof event.ts === "string" ? event.ts : null, input: event.input });
      continue;
    }
    if (event.type !== "step.end") continue;
    const nodes = nodesOf(event.nodes);
    if (nodes.length === 0) continue;
    const stepType = typeof event.stepType === "string" ? event.stepType : "";
    const byAgent = stepType.startsWith(TOOL_PREFIX);
    const tool = byAgent ? stepType.slice(TOOL_PREFIX.length) : stepType;
    const start = starts.get(event.path);
    const search = isSearch(tool);
    calls.push({
      path: event.path,
      tool,
      by: byAgent ? "agent" : "workflow",
      access: accessOf(tool),
      startedAt: start?.ts ?? null,
      endedAt: typeof event.ts === "string" ? event.ts : null,
      durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
      query: queryOf(start?.input),
      nodes: search ? [] : nodes,
      ...(search ? { hits: nodes.length } : {}),
    });
  }
  return calls;
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
