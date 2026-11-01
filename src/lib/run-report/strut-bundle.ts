/**
 * A `harvey-lab-run` strut run as a run report bundle: the wire shape
 * Stakwork's `build_report.py` writes (see `types.ts`), so `projectBundle`
 * sanitizes, redacts and projects it and `RunReportView` renders it like a
 * Stakwork run's report. Pure — the caller reads the run back from its lab
 * (`services/strut-runs/legal-report`).
 *
 * Where each section comes from:
 *  - config, score, rubrics, outputs: the run's input and its score body
 *    (`output.callback`); a criterion's `match_criteria` is the task's own,
 *    joined by id.
 *  - timeline, agents, branches, health notes, log stats and tool activity:
 *    the event log. The timeline is the run's direct steps; agents are its
 *    `agent` steps, foreach iterations included; tool activity is the
 *    agents' graph reads with the nodes each call reported.
 *  - source_docs: the converted inputs (`sources/<file>.txt`) and the
 *    deliverables; workfiles: the checklist, facts, case law and critiques.
 *  - rubric_links: each criterion's distinctive terms (`rubricTokens`, the
 *    chain's own) found in each document's text.
 *  - process: what the run followed (concepts read, nodes written, checklist,
 *    spreadsheets, per-step concepts), derived at read time (`./process`).
 * The run has no analysis pass and no security scan: `analysis`, the
 * concept synthesis and `security` are empty.
 */

import type { StrutRunEvent } from "@/lib/legal-cascade/strut";
import { rubricTokens } from "./chain";
import { buildProcess } from "./process";
import type { RunGraphTrace } from "@/lib/strut-run-graph/types";

export interface StrutReportSource {
  /** The original file name (`credit-agreement-excerpts.docx`). */
  name: string;
  /** Its conversion, as the run's agents and judge read it. */
  text: string;
}

export interface StrutReportDeliverable {
  name: string;
  html: string;
  text: string;
}

export interface StrutReportInput {
  workflow: string;
  strutRunId: string;
  /** The StrutRun row's `input` and `output`. */
  input: unknown;
  output: unknown;
  durationMs: number | null;
  events: StrutRunEvent[];
  sources: StrutReportSource[];
  deliverables: StrutReportDeliverable[];
  workfiles: Array<{ name: string; text: string }>;
  /** The run's graph trace when the graph answered; its edges draw the Process section's graphs. */
  graphTrace?: Pick<RunGraphTrace, "edges" | "nodes"> | null;
}

/** Working files a report shows, besides `critiques/*.md`. Never `work/` (privileged drafts, internal notes). */
const WORKFILES = new Set(["checklist.md", "facts.md", "case-law-research.md", "spreadsheet.md"]);
const MAX_SOURCES = 40;
const MAX_WORKFILES = 20;
const MAX_ANSWER_CHARS = 20_000;
const MAX_HEALTH_NOTES = 30;

/** strut's graph read tools in the report's `TOOL_CLASS` vocabulary. Writes and non-graph tools are not tool activity. */
const READ_TOOLS: Record<string, string> = {
  graph_graph_search: "graph_search",
  graph_graph_get: "graph_get",
  graph_graph_get_batched: "graph_get",
  graph_graph_neighbors: "graph_neighbors",
  graph_get_ontology: "get_ontology",
  graph_get_ontology_type: "get_ontology_type",
};

/** Which of the run's files the report reads: the converted sources and the working files. */
export function reportFilesOf(files: string[]): { sources: string[]; workfiles: string[] } {
  const sources = files.filter((f) => /^sources\/[^/]+\.txt$/.test(f)).slice(0, MAX_SOURCES);
  const workfiles = files
    .filter((f) => WORKFILES.has(f) || /^critiques\/[^/]+\.md$/.test(f))
    .slice(0, MAX_WORKFILES);
  return { sources, workfiles };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const ms = (ts: string | undefined): number | null => {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

function errorText(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : JSON.stringify(error ?? "");
}

interface Span {
  id: string;
  stepType: string;
  start: StrutRunEvent | null;
  end: StrutRunEvent | null;
  skipped: boolean;
  order: number;
}

/** The run's non-tool steps by path (relative to the run): first start, last end. */
function spansOf(events: StrutRunEvent[], workflow: string): Map<string, Span> {
  const spans = new Map<string, Span>();
  events.forEach((e, order) => {
    if (!e.path || e.stepType?.startsWith("tool:")) return;
    if (!e.path.startsWith(`${workflow}/`)) return;
    const id = e.path.slice(workflow.length + 1);
    let span = spans.get(id);
    if (!span) {
      span = { id, stepType: e.stepType ?? "", start: null, end: null, skipped: false, order };
      spans.set(id, span);
    }
    if (e.type === "step.start") span.start ??= e;
    else if (e.type === "step.end" || e.type === "step.error") span.end = e;
    else if (e.type === "step.skipped") span.skipped = true;
  });
  return spans;
}

function durationS(span: Span): number | null {
  const d = num((span.end as { durationMs?: unknown } | null)?.durationMs);
  if (d !== undefined) return d / 1000;
  const a = ms(span.start?.ts);
  const b = ms(span.end?.ts);
  return a !== null && b !== null ? (b - a) / 1000 : null;
}

/** The agent a step path belongs to: the nearest enclosing `agent` step. */
function ownerAgent(id: string, agents: Set<string>): string | null {
  let at = id;
  while (at.includes("/")) {
    at = at.slice(0, at.lastIndexOf("/"));
    if (agents.has(at)) return at;
  }
  return null;
}

function answerOf(end: StrutRunEvent | null): string {
  if (!end) return "";
  if (end.type === "step.error") return `Error: ${errorText(end.error)}`;
  const output = end.output;
  if (typeof output === "string") return cap(output, MAX_ANSWER_CHARS);
  if (!isRecord(output)) return "";
  if (typeof output.result === "string" && output.result.trim()) return cap(output.result, MAX_ANSWER_CHARS);
  return output.object !== undefined ? cap(JSON.stringify(output.object), MAX_ANSWER_CHARS) : "";
}

function fileNameOf(url: string): string {
  const last = url.split("?")[0].split("/").pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The nodes a read returned, from its output when strut reported none: a
 * search's result is a JSON array the log cuts off mid-way, so the complete
 * objects before the cut are read and the rest is lost.
 */
export function nodesFromOutput(output: unknown, max = 50): Array<{ ref_id: string; node_type?: string; name?: string }> {
  if (typeof output !== "string" || !output.trimStart().startsWith("[")) return [];
  const nodes: Array<{ ref_id: string; node_type?: string; name?: string }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = output.indexOf("[") + 1; i < output.length && nodes.length < max; i++) {
    const ch = output[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const node = JSON.parse(output.slice(start, i + 1)) as Record<string, unknown>;
          if (typeof node.ref_id === "string") {
            nodes.push({
              ref_id: node.ref_id,
              ...(typeof node.node_type === "string" ? { node_type: node.node_type } : {}),
              ...(typeof node.name === "string" ? { name: node.name } : {}),
            });
          }
        } catch {
          // Not a node object; skip it.
        }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return nodes;
}

/** File name → bytes, from the `docs` step's report of what it downloaded. */
function documentSizes(spans: Map<string, Span>): Map<string, number> {
  const sizes = new Map<string, number>();
  const output = spans.get("docs")?.end?.output;
  const stdout = isRecord(output) ? output.stdout : undefined;
  let parsed: unknown;
  try {
    parsed = typeof stdout === "string" ? JSON.parse(stdout) : stdout;
  } catch {
    return sizes;
  }
  const docs = isRecord(parsed) && Array.isArray(parsed.documents) ? parsed.documents : [];
  for (const d of docs) {
    if (isRecord(d) && typeof d.filename === "string" && typeof d.bytes === "number") sizes.set(d.filename, d.bytes);
  }
  return sizes;
}

export function buildStrutReportBundle(run: StrutReportInput): Record<string, unknown> {
  const { workflow, events } = run;
  const runStart = events.find((e) => e.type === "run.start");
  const runEnd = events.find((e) => e.type === "run.end" || e.type === "run.error");
  const taskInput = { ...(isRecord(runStart?.input) ? runStart.input : {}), ...(isRecord(run.input) ? run.input : {}) };
  const output = isRecord(run.output) ? run.output : {};
  const body = isRecord(output.callback) ? output.callback : {};
  const spans = spansOf(events, workflow);

  // ── timeline: the run's direct steps ────────────────────────────────────────
  const direct = [...spans.values()].filter((s) => !s.id.includes("/") && !s.id.includes("#") && s.start);
  const timeline = direct.map((s) => ({
    step: s.id,
    start: s.start?.ts ?? null,
    end: s.end?.ts ?? null,
    duration_s: durationS(s),
  }));

  // ── agents and their tool calls ─────────────────────────────────────────────
  const agentSpans = [...spans.values()].filter((s) => s.stepType === "agent" && s.start);
  const agentIds = new Set(agentSpans.map((s) => s.id));
  const toolsByAgent = new Map<string, Set<string>>();
  const toolActivity: Record<string, unknown>[] = [];
  const ends = new Map<string, StrutRunEvent>();
  for (const e of events) {
    if (e.path && e.stepType?.startsWith("tool:") && (e.type === "step.end" || e.type === "step.error")) ends.set(e.path, e);
  }
  let toolCalls = 0;
  let toolErrors = 0;
  for (const e of events) {
    if (!e.path || e.type !== "step.start" || !e.stepType?.startsWith("tool:")) continue;
    const id = e.path.startsWith(`${workflow}/`) ? e.path.slice(workflow.length + 1) : e.path;
    const agent = ownerAgent(id, agentIds);
    const strutTool = e.stepType.slice("tool:".length);
    const end = ends.get(e.path);
    toolCalls += 1;
    if (end?.type === "step.error") toolErrors += 1;
    if (!agent) continue;
    const tools = toolsByAgent.get(agent) ?? new Set<string>();
    tools.add(strutTool.startsWith("graph_") ? strutTool.slice("graph_".length) : strutTool);
    toolsByAgent.set(agent, tools);
    const tool = READ_TOOLS[strutTool];
    if (!tool) continue;
    toolActivity.push({
      seq: toolActivity.length,
      agent_name: agent,
      tool_name: tool,
      input: isRecord(e.input) ? e.input : e.input === undefined ? {} : { value: e.input },
      nodes:
        end?.type !== "step.end"
          ? []
          : Array.isArray(end.nodes) && end.nodes.length > 0
            ? end.nodes
            : nodesFromOutput(end.output),
      ...(end?.type === "step.error" ? { error: true } : {}),
    });
  }

  const agents = agentSpans.map((s) => {
    const start = isRecord(s.start?.input) ? s.start.input : {};
    const end = s.end as (StrutRunEvent & { modelCalls?: unknown; cost?: unknown }) | null;
    return {
      name: s.id,
      step: s.id.split("/")[0].replace(/#\d+$/, ""),
      agent_label: s.id,
      start: s.start?.ts ?? null,
      end: s.end?.ts ?? null,
      duration_s: durationS(s),
      n_messages: num(end?.modelCalls) ?? null,
      tools: [...(toolsByAgent.get(s.id) ?? [])].sort(),
      final_answer: answerOf(s.end),
      model: str(start.model) ?? null,
      cost_usd: num(end?.cost) ?? null,
      status: !s.end ? "unfinished" : s.end.type === "step.error" ? "error" : "success",
    };
  });

  // ── branches and health ─────────────────────────────────────────────────────
  const branches: string[] = [];
  for (const s of [...spans.values()].sort((a, b) => a.order - b.order)) {
    if (s.skipped) branches.push(`SKIPPED: ${s.id}`);
    else if (s.stepType === "if" && s.end?.type === "step.end") {
      branches.push(`${s.id}: ${s.end.output === true ? "then" : s.end.output === false ? "else" : JSON.stringify(s.end.output)}`);
    }
  }

  const health: string[] = [];
  for (const s of spans.values()) {
    if (s.end?.type === "step.error") health.push(`${s.id} failed: ${cap(errorText(s.end.error), 300)}`);
  }
  if (runEnd) {
    for (const a of agents) if (a.status === "unfinished") health.push(`${a.name} never finished`);
  }
  if (toolErrors > 0) health.push(`${toolErrors} of ${toolCalls} tool calls failed`);
  const gradingErrors = num(body.n_grading_errors);
  if (gradingErrors) health.push(`${gradingErrors} criteria could not be graded`);
  const graph = isRecord(output.graph) ? output.graph : {};
  if (Array.isArray(graph.requirements_missing) && graph.requirements_missing.length > 0) {
    health.push(`Rubric requirements missing from the graph: ${graph.requirements_missing.map(String).join(", ")}`);
  }
  const agentsOut = isRecord(output.agents) ? output.agents : {};
  const critiques = isRecord(agentsOut.critiques) ? agentsOut.critiques : {};
  if (isRecord(critiques.failed)) {
    for (const [name, why] of Object.entries(critiques.failed)) health.push(`Critique ${name} failed: ${cap(errorText(why), 300)}`);
  }
  if (typeof agentsOut.case_law === "string" && agentsOut.case_law !== "ok") health.push(`Case-law research: ${agentsOut.case_law}`);

  // ── log stats ───────────────────────────────────────────────────────────────
  const usage = { model_calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  let cost = 0;
  for (const s of agentSpans) {
    const end = s.end as (StrutRunEvent & { modelCalls?: unknown; cost?: unknown }) | null;
    const u = isRecord(end?.usage) ? end.usage : {};
    usage.model_calls += num(end?.modelCalls) ?? 0;
    usage.input_tokens += num(u.inputTokens) ?? 0;
    usage.output_tokens += num(u.outputTokens) ?? 0;
    usage.cache_read_tokens += num(u.cacheReadTokens) ?? 0;
    usage.cache_write_tokens += num(u.cacheWriteTokens) ?? 0;
    cost += num(end?.cost) ?? 0;
  }

  const wallMs =
    run.durationMs ??
    (ms(runStart?.ts) !== null && ms(runEnd?.ts) !== null ? (ms(runEnd?.ts) as number) - (ms(runStart?.ts) as number) : null);

  // ── rubrics, documents, links ───────────────────────────────────────────────
  const matchById = new Map<string, string>();
  for (const c of Array.isArray(taskInput.rubrics_json) ? taskInput.rubrics_json : []) {
    if (isRecord(c) && typeof c.id === "string" && typeof c.match_criteria === "string") matchById.set(c.id, c.match_criteria);
  }
  const rubrics = (Array.isArray(body.criteria_results) ? body.criteria_results : [])
    .filter(isRecord)
    .filter((c) => typeof c.id === "string")
    .map((c): Record<string, unknown> => ({ ...c, match_criteria: str(c.match_criteria) ?? matchById.get(c.id as string) ?? "" }));

  const sizes = documentSizes(spans);
  const documentNames = (Array.isArray(taskInput.documents_json) ? taskInput.documents_json : [])
    .filter((u): u is string => typeof u === "string")
    .map(fileNameOf);
  for (const s of run.sources) if (!documentNames.includes(s.name)) documentNames.push(s.name);
  const documents = documentNames.map((file) => ({
    file,
    strategy: file.includes(".") ? file.slice(file.lastIndexOf(".") + 1) : "file",
    ...(sizes.has(file) ? { size_bytes: sizes.get(file) } : {}),
  }));

  const docs = [
    ...run.deliverables.map((d) => ({ id: `deliverable-${d.name}`, title: `FINAL DELIVERABLE: ${d.name}`, html: d.html, text: d.text })),
    ...run.sources.map((s) => ({ id: s.name, title: s.name, html: `<pre>${escapeHtml(s.text)}</pre>`, text: s.text })),
  ];
  const lowered = docs.map((d) => ({ id: d.id, text: d.text.toLowerCase() }));
  const rubricLinks: Record<string, Array<{ doc: string; tokens: string[] }>> = {};
  for (const r of rubrics) {
    const title = str(r.title) ?? (r.id as string);
    const tokens = rubricTokens(title, str(r.match_criteria) || str(r.reasoning) || "").filter((t) => t.trim().length >= 3);
    if (tokens.length === 0) continue;
    const links = lowered
      .map((d) => ({ doc: d.id, tokens: tokens.filter((t) => d.text.includes(t.trim().toLowerCase())) }))
      .filter((l) => l.tokens.length > 0);
    if (links.length > 0) rubricLinks[r.id as string] = links;
  }

  const nPassed = num(body.n_passed);
  const nTotal = num(body.n_total);
  return {
    schema_version: 2,
    generated_at: runEnd?.ts ?? null,
    page_data: {
      config: {
        task_slug: str(taskInput.task_slug) ?? null,
        task_title: str(taskInput.task_title) ?? null,
        task_goal: str(taskInput.task_goal) ?? null,
        task_output_desc: str(taskInput.task_output_desc) ?? null,
        run_id: run.strutRunId,
        workflow,
        namespace: str(taskInput.namespace) ?? null,
        models: {
          reasoning_model: str(body.model) ?? null,
          standard_model: str(body.standard_model) ?? null,
          judge_model: str(body.judge_model) ?? null,
        },
        flags: {
          agent_ingestion_flag: taskInput.agent_ingestion_flag ?? null,
          cross_checker_agent: taskInput.cross_checker_agent ?? null,
          use_case_law_research: taskInput.use_case_law_research ?? null,
        },
      },
      score: {
        score: num(body.score) ?? null,
        max_score: num(body.max_score) ?? null,
        all_pass: typeof body.all_pass === "boolean" ? body.all_pass : null,
        n_criteria: nTotal ?? null,
        n_passed: nPassed ?? null,
        judge_model: str(body.judge_model) ?? null,
        scored_at: null,
      },
      rubrics,
      timeline,
      agents,
      documents,
      branches,
      health_notes: health.slice(0, MAX_HEALTH_NOTES),
      wall_clock_min: wallMs !== null ? wallMs / 60_000 : null,
      log_stats: {
        events: events.length,
        steps: spans.size,
        agents: agents.length,
        tool_calls: toolCalls,
        ...usage,
        cost_usd: Math.round(cost * 100) / 100,
      },
      security: [],
      outputs: {
        deliverables: isRecord(body.final_output) ? body.final_output : {},
        ...(str(body.spreadsheet_url) ? { spreadsheet_url: body.spreadsheet_url } : {}),
        ...(isRecord(output.disputes) ? { disputes: output.disputes } : {}),
        ...(str(graph.evalset_ref_id) ? { evalset_ref_id: graph.evalset_ref_id } : {}),
        ...(str(body.eval_trigger_ref_id) ? { eval_trigger_ref_id: body.eval_trigger_ref_id } : {}),
        ...(str(body.eval_trigger_output_ref_id) ? { eval_trigger_output_ref_id: body.eval_trigger_output_ref_id } : {}),
      },
    },
    analysis: { summaries: [], traces: [] },
    concepts: { tool_activity: toolActivity },
    source_docs: docs.map(({ id, title, html }) => ({ id, title, html })),
    workfiles: run.workfiles,
    rubric_links: rubricLinks,
    process: buildProcess({
      workflow,
      events,
      output: run.output,
      workfiles: run.workfiles,
      trace: run.graphTrace,
    }),
  };
}
