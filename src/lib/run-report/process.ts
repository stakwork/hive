/**
 * The process a strut legal run followed, for the report's Process section
 * and the task modal's summary. Pure: built from what the run already
 * leaves — its event log, its lab files, its score body — and, when the
 * graph answered, the edges among the nodes it touched. Anything the run did
 * not record is `null` / absent, never a number made up.
 *
 * Step placement: a graph call's event path is `<workflow>/<step>[#n]/<seq>-<tool>`,
 * so the first segment under the workflow is the step (the same `step` the
 * report's timeline and agents carry). A call outside the workflow's own
 * paths is not placed.
 */

import { accessOf, isSearch, projectRunGraphCalls } from "@/lib/strut-run-graph/project";
import type { RunGraphCall, RunGraphTrace } from "@/lib/strut-run-graph/types";
import type {
  ProcessConcept,
  ProcessCreatedNode,
  ProcessEdge,
  ProcessProjection,
  ProcessStep,
} from "./types";

const MAX_STEPS = 30;
const MAX_CONCEPTS_PER_STEP = 40;
const MAX_CREATED_PER_STEP = 100;
const MAX_LINKS_PER_STEP = 200;
const MAX_CHECKLIST_ITEMS = 200;
const MAX_RAW_CHARS = 4000;
const MAX_TEXT = 300;
const MAX_SPREADSHEETS = 5;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (s: string, max = MAX_TEXT) => (s.length > max ? `${s.slice(0, max)}…` : s);

export interface ProcessInput {
  workflow: string;
  events: unknown[];
  /** The StrutRun row's `output`. */
  output: unknown;
  workfiles: Array<{ name: string; text: string }>;
  /** The run's graph trace, when the graph answered: its edges draw the links. */
  trace?: Pick<RunGraphTrace, "edges" | "nodes"> | null;
}

/** An https URL without credentials, else null. */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** `- [x] text` / `* [ ] text` lines. */
export function parseChecklist(text: string): { items: Array<{ text: string; done: boolean }>; raw?: string } {
  const items: Array<{ text: string; done: boolean }> = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (m && items.length < MAX_CHECKLIST_ITEMS) items.push({ text: clip(m[2]), done: m[1] !== " " });
  }
  return items.length > 0 ? { items } : { items, raw: clip(text.trim(), MAX_RAW_CHARS) };
}

function spreadsheetsOf(output: unknown, workfiles: ProcessInput["workfiles"]): ProcessProjection["spreadsheets"] {
  const out: ProcessProjection["spreadsheets"] = [];
  const add = (url: string | null, label: string) => {
    if (url && out.length < MAX_SPREADSHEETS && !out.some((s) => s.url === url)) out.push({ url, label });
  };
  const body = isRecord(output) && isRecord(output.callback) ? output.callback : {};
  add(safeHttpsUrl(body.spreadsheet_url), "Run spreadsheet");
  const file = workfiles.find((w) => w.name === "spreadsheet.md");
  if (file) {
    const m = /^\s*url:\s*(\S+)/im.exec(file.text);
    add(safeHttpsUrl(m?.[1]), "Shared spreadsheet");
  }
  return out;
}

/** `ingest#0` → `ingest`; the step a call's event path belongs to, or null. */
export function stepOfPath(path: string, workflow: string): string | null {
  if (!path.startsWith(`${workflow}/`)) return null;
  const first = path.slice(workflow.length + 1).split("/")[0];
  return first ? first.replace(/#\d+$/, "") : null;
}

interface Known {
  name?: string;
  node_type?: string;
}

/** Names and types as the log's own `nodes` reported them, and edges a write event listed. */
function scanEvents(events: unknown[]): { known: Map<string, Known>; edgesByPath: Map<string, ProcessEdge[]> } {
  const known = new Map<string, Known>();
  const edgesByPath = new Map<string, ProcessEdge[]>();
  for (const e of events) {
    if (!isRecord(e) || e.type !== "step.end") continue;
    if (Array.isArray(e.nodes)) {
      for (const n of e.nodes) {
        if (!isRecord(n) || typeof n.ref_id !== "string") continue;
        const prev = known.get(n.ref_id) ?? {};
        known.set(n.ref_id, {
          name: prev.name ?? (typeof n.name === "string" && n.name ? n.name : undefined),
          node_type: prev.node_type ?? (typeof n.node_type === "string" && n.node_type ? n.node_type : undefined),
        });
      }
    }
    if (typeof e.path === "string" && Array.isArray(e.edges)) {
      const edges: ProcessEdge[] = [];
      for (const x of e.edges) {
        if (!isRecord(x)) continue;
        const source = x.source ?? x.source_ref_id;
        const target = x.target ?? x.target_ref_id;
        const type = x.edge_type ?? x.type;
        if (typeof source === "string" && typeof target === "string" && source && target) {
          edges.push({ source, target, ...(typeof type === "string" && type ? { edge_type: type } : {}) });
        }
      }
      if (edges.length > 0) edgesByPath.set(e.path, edges);
    }
  }
  return { known, edgesByPath };
}

export function buildProcess(input: ProcessInput): ProcessProjection {
  const { workflow, events, output, workfiles, trace } = input;
  const calls = projectRunGraphCalls(events);
  const { known, edgesByPath } = scanEvents(events);
  const traceNames = new Map((trace?.nodes ?? []).map((n) => [n.ref_id, n] as const));
  const nameOf = (ref: string) => known.get(ref)?.name ?? traceNames.get(ref)?.name ?? ref;
  const typeOf = (ref: string, hinted?: string) =>
    hinted ?? known.get(ref)?.node_type ?? traceNames.get(ref)?.node_type;

  const readConcepts = new Set<string>();
  const writtenNodes = new Set<string>();
  const writtenEdges = new Set<string>();
  let writeCalls = 0;
  let writeEdgeCalls = 0;

  interface StepAcc {
    concepts: Map<string, ProcessConcept>;
    nodes: Map<string, ProcessCreatedNode>;
    edges: Map<string, ProcessEdge>;
  }
  const steps = new Map<string, StepAcc>();
  let placed = 0;

  for (const call of calls as RunGraphCall[]) {
    const write = call.access === "write" || accessOf(call.tool) === "write";
    if (!write && isSearch(call.tool)) continue;
    const step = stepOfPath(call.path, workflow);
    const listed = edgesByPath.get(call.path) ?? [];
    if (write && call.nodes.length > 0) writeCalls += 1;
    if (write && listed.length > 0) writeEdgeCalls += 1;
    for (const e of listed) writtenEdges.add(`${e.source}|${e.edge_type ?? ""}|${e.target}`);

    let acc: StepAcc | undefined;
    if (step) {
      placed += 1;
      acc = steps.get(step);
      if (!acc && steps.size < MAX_STEPS) {
        acc = { concepts: new Map(), nodes: new Map(), edges: new Map() };
        steps.set(step, acc);
      }
      if (acc) for (const e of listed) acc.edges.set(`${e.source}|${e.edge_type ?? ""}|${e.target}`, e);
    }

    for (const n of call.nodes) {
      const type = typeOf(n.ref_id, n.node_type);
      if (write) {
        writtenNodes.add(n.ref_id);
        if (acc && acc.nodes.size < MAX_CREATED_PER_STEP) {
          acc.nodes.set(n.ref_id, { ref_id: n.ref_id, name: nameOf(n.ref_id), ...(type ? { node_type: type } : {}) });
        }
      }
      if (type !== "Concept") continue;
      if (!write) readConcepts.add(n.ref_id);
      if (!acc) continue;
      const have = acc.concepts.get(n.ref_id);
      if (have) {
        have.calls += 1;
        if (write) have.access = "write";
      } else if (acc.concepts.size < MAX_CONCEPTS_PER_STEP) {
        acc.concepts.set(n.ref_id, {
          ref_id: n.ref_id,
          name: nameOf(n.ref_id),
          access: write ? "write" : "read",
          calls: 1,
        });
      }
    }
  }

  const traceEdges = trace?.edges ?? [];
  const processSteps: ProcessStep[] | null =
    placed === 0
      ? null
      : [...steps.entries()]
          .filter(([, a]) => a.concepts.size > 0 || a.nodes.size > 0)
          .map(([step, a]) => {
            const ids = new Set([...a.concepts.keys(), ...a.nodes.keys()]);
            const links = traceEdges
              .filter((e) => ids.has(e.source) && ids.has(e.target))
              .slice(0, MAX_LINKS_PER_STEP)
              .map((e): ProcessEdge => ({ source: e.source, target: e.target, edge_type: e.edge_type }));
            return {
              step,
              concepts: [...a.concepts.values()],
              created: { nodes: [...a.nodes.values()], edges: [...a.edges.values()] },
              links,
            };
          });

  const checklistFile = workfiles.find((w) => w.name === "checklist.md");

  return {
    ingestion: {
      conceptsRead: readConcepts.size,
      nodesCreated: writeCalls > 0 ? writtenNodes.size : null,
      edgesCreated: writeEdgeCalls > 0 ? writtenEdges.size : null,
    },
    checklist: checklistFile ? parseChecklist(checklistFile.text) : null,
    spreadsheets: spreadsheetsOf(output, workfiles),
    steps: processSteps,
  };
}

/** Concepts across steps, most-used first, each with the steps that used it. */
export interface RankedConcept {
  ref_id: string;
  name: string;
  steps: string[];
  calls: number;
}

export function rankConcepts(steps: ProcessStep[] | null | undefined): RankedConcept[] {
  const by = new Map<string, RankedConcept>();
  for (const s of steps ?? []) {
    for (const c of s.concepts) {
      const r = by.get(c.ref_id) ?? { ref_id: c.ref_id, name: c.name, steps: [], calls: 0 };
      if (!r.steps.includes(s.step)) r.steps.push(s.step);
      r.calls += c.calls;
      by.set(c.ref_id, r);
    }
  }
  return [...by.values()].sort(
    (a, b) => b.calls - a.calls || b.steps.length - a.steps.length || a.name.localeCompare(b.name),
  );
}

/** `checklist` progress for a summary: null when the checklist has no checkbox items. */
export function checklistProgress(p: ProcessProjection | null | undefined): { done: number; total: number } | null {
  const items = p?.checklist?.items ?? [];
  return items.length > 0 ? { done: items.filter((i) => i.done).length, total: items.length } : null;
}

// ── Projection-side narrowing (the wire shape is untrusted) ───────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown, max = MAX_TEXT): string | null => (typeof v === "string" && v ? clip(v, max) : null);

function edgesOf(v: unknown, max: number): ProcessEdge[] {
  if (!Array.isArray(v)) return [];
  const out: ProcessEdge[] = [];
  for (const e of v) {
    if (!isRecord(e) || out.length >= max) continue;
    const source = text(e.source);
    const target = text(e.target);
    const type = text(e.edge_type);
    if (source && target) out.push({ source, target, ...(type ? { edge_type: type } : {}) });
  }
  return out;
}

/** Rebuild a `process` bundle value from known fields only; null when it is not one. */
export function sanitizeProcess(raw: unknown): ProcessProjection | null {
  if (!isRecord(raw)) return null;
  const ing = isRecord(raw.ingestion) ? raw.ingestion : {};
  const checklist = isRecord(raw.checklist)
    ? {
        items: (Array.isArray(raw.checklist.items) ? raw.checklist.items : [])
          .filter(isRecord)
          .flatMap((i) => {
            const t = text(i.text);
            return t ? [{ text: t, done: i.done === true }] : [];
          })
          .slice(0, MAX_CHECKLIST_ITEMS),
        ...(text(raw.checklist.raw, MAX_RAW_CHARS) ? { raw: text(raw.checklist.raw, MAX_RAW_CHARS) as string } : {}),
      }
    : null;
  const spreadsheets = (Array.isArray(raw.spreadsheets) ? raw.spreadsheets : [])
    .filter(isRecord)
    .flatMap((s) => {
      const url = safeHttpsUrl(s.url);
      return url ? [{ url, label: text(s.label, 80) ?? "Spreadsheet" }] : [];
    })
    .slice(0, MAX_SPREADSHEETS);
  const steps = Array.isArray(raw.steps)
    ? raw.steps
        .filter(isRecord)
        .flatMap((s): ProcessStep[] => {
          const step = text(s.step, 80);
          if (!step) return [];
          const concepts = (Array.isArray(s.concepts) ? s.concepts : []).filter(isRecord).flatMap((c) => {
            const ref_id = text(c.ref_id);
            return ref_id
              ? [{ ref_id, name: text(c.name) ?? ref_id, access: c.access === "write" ? ("write" as const) : ("read" as const), calls: num(c.calls) ?? 1 }]
              : [];
          });
          const created = isRecord(s.created) ? s.created : {};
          const nodes = (Array.isArray(created.nodes) ? created.nodes : []).filter(isRecord).flatMap((n) => {
            const ref_id = text(n.ref_id);
            const type = text(n.node_type, 80);
            return ref_id ? [{ ref_id, name: text(n.name) ?? ref_id, ...(type ? { node_type: type } : {}) }] : [];
          });
          return [
            {
              step,
              concepts: concepts.slice(0, MAX_CONCEPTS_PER_STEP),
              created: { nodes: nodes.slice(0, MAX_CREATED_PER_STEP), edges: edgesOf(created.edges, MAX_CREATED_PER_STEP) },
              links: edgesOf(s.links, MAX_LINKS_PER_STEP),
            },
          ];
        })
        .slice(0, MAX_STEPS)
    : null;
  return {
    ingestion: { conceptsRead: num(ing.conceptsRead) ?? 0, nodesCreated: num(ing.nodesCreated), edgesCreated: num(ing.edgesCreated) },
    checklist,
    spreadsheets,
    steps,
  };
}
