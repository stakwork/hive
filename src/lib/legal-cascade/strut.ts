/**
 * A strut run's agents as the session cascade's wire types, so the legal
 * Traces view (`derive.ts`, `CascadeTrace`) renders a `harvey-lab-run` run
 * the way it renders a Stakwork run's stakgraph sessions. Pure.
 *
 * Source: the run's event log (`GET …/runs/:runId/events`).
 *  - Each `agent` step execution is a top-level session; a sub-agent (an
 *    `agent` TOOL call) is a child session, its parent the calling agent.
 *  - Its tool calls are the `tool:<name>` events one level below its path
 *    (`<agent path>/NNN-<tool>`), with their timestamps, call ids and the
 *    I/O as the log keeps it (truncated). The graph nodes a call reported
 *    (`step.end.nodes`) give the Concepts it READ, and name what a write
 *    created.
 *  - Turn 0 is the prompt the step (or the parent's call) handed it; the
 *    response is its output.
 *  - Reasoning text exists only in the agent's transcript, which strut
 *    records when the agent finishes: `reasoningByCall` reads it, and
 *    `withReasoning` puts each text before the call it led to.
 *
 * Orders are fixed slots so a live chain and its finished form agree: the
 * prompt is 0; call k is 3k+2, its result 3k+3, the reasoning before it
 * 3k+1; the response 3n+1 for n calls.
 */

import type {
  CascadeConcept,
  CascadeSession,
  CascadeSessionStatus,
  CascadeTokenUsage,
  CascadeTurn,
} from "@/lib/legal-cascade/types";
import { SUB_AGENT_TOOL } from "@/lib/legal-cascade/derive";

/** What one turn's content may hold — the log already truncates tool I/O. */
export const STRUT_TURN_CONTENT_MAX = 4_000;

/** An event of strut's run log, as `GET …/events` serves it. */
export interface StrutRunEvent {
  type: string;
  path?: string;
  stepType?: string;
  ts?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  toolCallId?: string;
  nodes?: Array<{ ref_id?: string; node_type?: string; name?: string }>;
  usage?: Record<string, unknown>;
  /** The agent's transcript link (strut replaces `messages` with it). */
  transcript?: string;
}

export interface StrutTraceSession {
  session: CascadeSession;
  /** The turns the log alone gives (no reasoning). */
  turns: CascadeTurn[];
  /** Ended (or the run did): its chain will not grow. */
  finished: boolean;
  /** strut's transcript link, once the agent ended. */
  transcript: string | null;
}

export interface StrutTrace {
  /** Session id → session; ids are step paths relative to the workflow. */
  sessions: Map<string, StrutTraceSession>;
}

const WRITE_TOOLS = new Set(["create_triplet", "create_batch_triplet", "create_node", "edit_node"]);
const NODE_WRITE_TOOLS = new Set(["create_batch_triplet", "create_node", "edit_node"]);

/** strut's tool names in the cascade's vocabulary: `graph_graph_search` → `graph_search`, `agent` → the sub-agent fork. */
export function cascadeToolName(strutTool: string): string {
  if (strutTool === "agent") return SUB_AGENT_TOOL;
  return strutTool.startsWith("graph_") ? strutTool.slice("graph_".length) : strutTool;
}

const ms = (ts: string | undefined): number | null => {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cap(text: string): string {
  return text.length > STRUT_TURN_CONTENT_MAX ? `${text.slice(0, STRUT_TURN_CONTENT_MAX)}…` : text;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return cap(typeof value === "string" ? value : JSON.stringify(value));
}

function errorText(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return asText(error);
}

function tokenUsage(usage: Record<string, unknown> | undefined): CascadeTokenUsage | null {
  if (!usage) return null;
  const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return {
    input: n("inputTokens"),
    cache_read: n("cacheReadTokens"),
    cache_write: n("cacheWriteTokens"),
    output: n("outputTokens"),
    total: n("totalTokens"),
  };
}

/** The agent's answer: its `result` text, else its structured object. */
function responseText(output: unknown): string {
  if (!isRecord(output)) return asText(output);
  if (typeof output.result === "string" && output.result.trim()) return cap(output.result);
  if (output.object !== undefined) return asText(output.object);
  return asText(output);
}

/**
 * A write's input with the name of the first node it reported, so the
 * cascade labels the row by what was written (`parseCreatedLabel` reads a
 * top-level `name`); strut's batch input names nodes as `source_data.name`.
 */
function writeContent(tool: string, input: unknown, nodes: StrutRunEvent["nodes"]): string {
  const first = nodes?.find((n) => typeof n.name === "string" && n.name);
  if (!NODE_WRITE_TOOLS.has(tool) || !first || !isRecord(input) || typeof input.name === "string") return asText(input);
  return asText({ name: first.name, ...input });
}

function readConcepts(tool: string, nodes: StrutRunEvent["nodes"]): CascadeConcept[] {
  if (WRITE_TOOLS.has(tool) || !nodes) return [];
  return nodes
    .filter((n) => n.node_type === "Concept" && n.ref_id)
    .map((n) => ({ ref_id: n.ref_id as string, id: null, name: n.name ?? "" }));
}

interface Building {
  id: string;
  parentId: string;
  label: string;
  prompt: string;
  startTs: string;
  model: string | null;
  calls: Array<{ start: StrutRunEvent; end: StrutRunEvent | null }>;
  end: StrutRunEvent | null;
  lastAt: number | null;
}

/** Fold the log into sessions. `runFinished`: the run ended, so an agent with no end was cut off. */
export function buildStrutTrace(events: StrutRunEvent[], workflow: string, runFinished: boolean): StrutTrace {
  const rel = (path: string) => (path.startsWith(`${workflow}/`) ? path.slice(workflow.length + 1) : path);
  const building = new Map<string, Building>();
  const callOf = new Map<string, { start: StrutRunEvent; end: StrutRunEvent | null }>();

  for (const e of events) {
    if (!e.path) continue;
    const id = rel(e.path);
    const at = ms(e.ts);
    const parent = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";

    // An agent step: a new attempt at a path starts its session afresh.
    if (e.stepType === "agent" && e.type === "step.start") {
      const input = isRecord(e.input) ? e.input : {};
      building.set(id, {
        id,
        parentId: "",
        label: id,
        prompt: asText(input.prompt),
        startTs: e.ts ?? new Date(0).toISOString(),
        model: typeof input.model === "string" ? input.model : null,
        calls: [],
        end: null,
        lastAt: at,
      });
      continue;
    }
    if (e.stepType === "agent" && (e.type === "step.end" || e.type === "step.error")) {
      const s = building.get(id);
      if (s) {
        s.end = e;
        s.lastAt = at ?? s.lastAt;
      }
      continue;
    }

    if (!e.stepType?.startsWith("tool:")) continue;
    const owner = building.get(parent);
    if (!owner) continue;
    owner.lastAt = at ?? owner.lastAt;

    if (e.type === "step.start") {
      const call = { start: e, end: null };
      owner.calls.push(call);
      callOf.set(id, call);
      // A sub-agent: the call is a session of its own, under the caller.
      if (e.stepType === "tool:agent") {
        const input = isRecord(e.input) ? e.input : {};
        building.set(id, {
          id,
          parentId: owner.id,
          label: "",
          prompt: asText(input.prompt),
          startTs: e.ts ?? owner.startTs,
          model: typeof input.model === "string" ? input.model : owner.model,
          calls: [],
          end: null,
          lastAt: at,
        });
      }
    } else if (e.type === "step.end" || e.type === "step.error") {
      const call = callOf.get(id);
      if (call) call.end = e;
      const sub = e.stepType === "tool:agent" ? building.get(id) : undefined;
      if (sub) {
        sub.end = e;
        sub.lastAt = at ?? sub.lastAt;
      }
    }
  }

  const sessions = new Map<string, StrutTraceSession>();
  for (const b of building.values()) {
    const turns: CascadeTurn[] = [
      {
        order: 0,
        turn_id: `${b.id}:0`,
        turn_type: "user_input",
        tool: null,
        tool_call_id: null,
        content: b.prompt,
        timestamp: ms(b.startTs),
        concepts: [],
      },
    ];
    b.calls.forEach(({ start, end }, k) => {
      const strutTool = (start.stepType ?? "tool:unknown").slice("tool:".length);
      const tool = cascadeToolName(strutTool);
      const callId = start.toolCallId ?? null;
      turns.push({
        order: 3 * k + 2,
        turn_id: `${b.id}:${3 * k + 2}`,
        turn_type: "tool_call",
        tool,
        tool_call_id: callId,
        content: writeContent(tool, start.input, end?.nodes),
        timestamp: ms(start.ts),
        concepts: [],
      });
      if (end) {
        turns.push({
          order: 3 * k + 3,
          turn_id: `${b.id}:${3 * k + 3}`,
          turn_type: "tool_result",
          tool,
          tool_call_id: callId,
          content: end.type === "step.error" ? `Error: ${errorText(end.error)}` : asText(end.output),
          timestamp: ms(end.ts),
          concepts: end.type === "step.end" ? readConcepts(tool, end.nodes) : [],
        });
      }
    });
    if (b.end) {
      const order = 3 * b.calls.length + 1;
      turns.push({
        order,
        turn_id: `${b.id}:${order}`,
        turn_type: "response",
        tool: null,
        tool_call_id: null,
        content: b.end.type === "step.error" ? `Error: ${errorText(b.end.error)}` : responseText(b.end.output),
        timestamp: ms(b.end.ts),
        concepts: [],
      });
    }

    const status: CascadeSessionStatus = b.end
      ? b.end.type === "step.error"
        ? "error"
        : "success"
      : runFinished
        ? "aborted"
        : "running";
    const childCount = [...building.values()].filter((c) => c.parentId === b.id).length;
    sessions.set(b.id, {
      session: {
        id: b.id,
        parent_session_id: b.parentId,
        agent_name: b.label,
        source: "strut",
        status,
        turn_count: turns.length,
        last_turn_at: b.lastAt,
        timestamp: b.startTs,
        model: b.model,
        repo: null,
        token_usage: tokenUsage(isRecord(b.end?.usage) ? (b.end?.usage as Record<string, unknown>) : undefined),
        child_count: childCount,
      },
      turns,
      finished: status !== "running",
      transcript: typeof b.end?.transcript === "string" ? b.end.transcript : null,
    });
  }
  return { sessions };
}

/**
 * The reasoning before each tool call, from an agent's transcript (AI SDK
 * model messages): the reasoning and text parts an assistant message holds
 * before a tool call are that call's lead-in.
 */
export function reasoningByCall(messages: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(messages)) return out;
  let buffer: string[] = [];
  for (const m of messages) {
    if (!isRecord(m) || m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content.trim()) buffer.push(m.content.trim());
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (!isRecord(part)) continue;
      if ((part.type === "reasoning" || part.type === "text") && typeof part.text === "string" && part.text.trim()) {
        buffer.push(part.text.trim());
      } else if (part.type === "tool-call" && typeof part.toolCallId === "string") {
        if (buffer.length) out.set(part.toolCallId, cap(buffer.join("\n\n")));
        buffer = [];
      }
    }
  }
  return out;
}

/** The chain with each call's reasoning in the slot before it. */
export function withReasoning(turns: CascadeTurn[], reasoning: Map<string, string>): CascadeTurn[] {
  if (reasoning.size === 0) return turns;
  const out: CascadeTurn[] = [];
  for (const t of turns) {
    const text = t.turn_type === "tool_call" && t.tool_call_id ? reasoning.get(t.tool_call_id) : undefined;
    if (text) {
      out.push({
        order: t.order - 1,
        turn_id: `${t.turn_id}:reasoning`,
        turn_type: "reasoning",
        tool: null,
        tool_call_id: null,
        content: text,
        timestamp: t.timestamp,
        concepts: [],
      });
    }
    out.push(t);
  }
  return out;
}

/** The top-level sessions, and every session below one (flat, each naming its parent). */
export function topSessions(trace: StrutTrace): CascadeSession[] {
  return [...trace.sessions.values()].filter((s) => !s.session.parent_session_id).map((s) => s.session);
}

export function descendantsOf(trace: StrutTrace, id: string): CascadeSession[] {
  const out: CascadeSession[] = [];
  const walk = (parent: string) => {
    for (const s of trace.sessions.values()) {
      if (s.session.parent_session_id !== parent) continue;
      out.push(s.session);
      walk(s.session.id);
    }
  };
  walk(id);
  return out;
}
