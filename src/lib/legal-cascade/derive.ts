import type {
  AgentCascade,
  AgentRow,
  CascadeRowModel,
  CascadeSession,
  CascadeTurn,
  ConceptVerb,
  PillRow,
  RunCascadeModel,
} from "./types";

/**
 * The fold from turn chains to "story rows" — all the cascade's correctness
 * lives here, as pure functions over wire data (no React, no network).
 *
 * Rules (§2 of the plan):
 * - user_input → user row (a child session's turn-0 prompt lives on its
 *   AgentRow instead, revealed on header click)
 * - any turn with concepts → one READ row per concept; NEVER folds into a pill
 * - tool_call of a create/edit tool → display-parsed CREATED/EDITED row;
 *   unparseable input folds into the surrounding pill
 * - tool_call of graph_sub_agent → fork: the child's rows splice in on the
 *   next lane; the matching tool_result is the merge point (consumed, drawn
 *   as a curve, not a row)
 * - response → response row
 * - every remaining maximal contiguous run of reasoning/tool_call/tool_result
 *   → one pill
 */

export const SUB_AGENT_TOOL = "graph_sub_agent";

const CREATE_TOOLS: Record<string, ConceptVerb> = {
  create_triplet: "CREATED",
  create_batch_triplet: "CREATED",
  create_node: "CREATED",
  edit_node: "EDITED",
};

/** Merge a page of turns into an existing chain: dedupe by order, sort asc. */
export function mergeTurns(
  existing: CascadeTurn[],
  incoming: CascadeTurn[],
): CascadeTurn[] {
  if (incoming.length === 0) return existing;
  const byOrder = new Map<number, CascadeTurn>();
  for (const t of existing) byOrder.set(t.order, t);
  // Overlap is harmless by design — later pages win.
  for (const t of incoming) byOrder.set(t.order, t);
  return [...byOrder.values()].sort((a, b) => a.order - b.order);
}

/**
 * Human label for a create/edit tool_call, parsed from its full input JSON.
 * Display-only provenance (v1) — returns null when nothing parseable, in
 * which case the turn folds into the surrounding pill.
 */
export function parseCreatedLabel(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const pick = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    const nodeData =
      obj.node_data && typeof obj.node_data === "object"
        ? (obj.node_data as Record<string, unknown>)
        : null;
    const candidates = [nodeData?.name, obj.name, nodeData?.node_type, obj.node_type];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return null;
  };
  const direct = pick(parsed);
  if (direct) return direct;
  // Batch inputs — label from the first entry.
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["triplets", "nodes", "batch"]) {
      const arr = obj[key];
      if (Array.isArray(arr) && arr.length > 0) {
        const first = pick(arr[0]);
        if (first) return first;
      }
    }
  }
  return null;
}

/** The prompt a graph_sub_agent fork was handed, from its input JSON. */
function parseForkPrompt(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { prompt?: unknown };
    return typeof parsed?.prompt === "string" ? parsed.prompt : null;
  } catch {
    return null;
  }
}

function byStartTime(a: CascadeSession, b: CascadeSession): number {
  const ta = Date.parse(a.timestamp) || 0;
  const tb = Date.parse(b.timestamp) || 0;
  return ta - tb || a.id.localeCompare(b.id);
}

export interface SessionTreeContext {
  /** parent session id → direct children. */
  childrenOf: Map<string, CascadeSession[]>;
  /** session id → merged turn chain. */
  turnsBySession: Map<string, CascadeTurn[]>;
}

function firstUserInput(turns: CascadeTurn[] | undefined): CascadeTurn | null {
  if (!turns) return null;
  let best: CascadeTurn | null = null;
  for (const t of turns) {
    if (t.turn_type !== "user_input") continue;
    if (!best || t.order < best.order) best = t;
  }
  return best;
}

/**
 * Join fork turns to child sessions: primary join by prompt text (the fork's
 * input `prompt` equals the child's turn-0 user_input), fallback join by
 * start-time order among the unmatched remainder.
 */
function matchForksToChildren(
  forkTurns: CascadeTurn[],
  children: CascadeSession[],
  ctx: SessionTreeContext,
): Map<number, CascadeSession> {
  const matched = new Map<number, CascadeSession>();
  const taken = new Set<string>();

  for (const fork of forkTurns) {
    const prompt = parseForkPrompt(fork.content);
    if (!prompt) continue;
    const child = children.find(
      (c) =>
        !taken.has(c.id) &&
        firstUserInput(ctx.turnsBySession.get(c.id))?.content === prompt,
    );
    if (child) {
      matched.set(fork.order, child);
      taken.add(child.id);
    }
  }

  const remainingChildren = children.filter((c) => !taken.has(c.id));
  const remainingForks = forkTurns.filter((f) => !matched.has(f.order));
  remainingForks.forEach((fork, i) => {
    const child = remainingChildren[i];
    if (child) {
      matched.set(fork.order, child);
      taken.add(child.id);
    }
  });

  return matched;
}

function makePill(
  turns: CascadeTurn[],
  sessionId: string,
  depth: number,
): PillRow {
  const tally = new Map<string, number>();
  let calls = 0;
  const texts: string[] = [];
  for (const t of turns) {
    if (t.turn_type === "tool_call") {
      calls += 1;
      const name = t.tool ?? "unknown";
      tally.set(name, (tally.get(name) ?? 0) + 1);
    } else if (t.turn_type === "reasoning") {
      texts.push(t.content);
    }
  }
  const stamps = turns
    .map((t) => t.timestamp)
    .filter((x): x is number => x != null);
  return {
    kind: "pill",
    depth,
    sessionId,
    timestamp: turns[0].timestamp,
    o0: turns[0].order,
    o1: turns[turns.length - 1].order,
    calls,
    texts,
    mix: [...tally.entries()].map(([tool, n]) => `${tool} ×${n}`).join(" · "),
    durationMs:
      stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : null,
    turns,
    open: false,
  };
}

function makeAgentRow(
  child: CascadeSession,
  depth: number,
  forkPrompt: string | null,
  ctx: SessionTreeContext,
): AgentRow {
  const childTurns = ctx.turnsBySession.get(child.id);
  return {
    kind: "agent",
    depth,
    sessionId: child.id,
    childSessionId: child.id,
    label: child.agent_name || SUB_AGENT_TOOL,
    prompt: forkPrompt ?? firstUserInput(childTurns)?.content ?? null,
    status: child.status,
    hasTrace: child.turn_count > 0 || (childTurns?.length ?? 0) > 0,
    timestamp: Date.parse(child.timestamp) || null,
  };
}

/**
 * Fold one session's chain into rows, splicing each matched child's own rows
 * (recursively) between its fork and merge points.
 */
export function deriveSessionRows(
  session: CascadeSession,
  depth: number,
  ctx: SessionTreeContext,
): CascadeRowModel[] {
  const turns = [...(ctx.turnsBySession.get(session.id) ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const sessionId = session.id;
  const children = [...(ctx.childrenOf.get(sessionId) ?? [])].sort(byStartTime);

  const forkTurns = turns.filter(
    (t) => t.turn_type === "tool_call" && t.tool === SUB_AGENT_TOOL,
  );
  const forkChild = matchForksToChildren(forkTurns, children, ctx);
  const splicedChildIds = new Set(
    [...forkChild.values()].map((c) => c.id),
  );

  // Merge points: the tool_result answering each fork. Consumed as rows —
  // they render as the child lane curving back. A result carrying concepts is
  // kept (concept rows always win).
  const mergeOrders = new Set<number>();
  for (const fork of forkTurns) {
    if (!fork.tool_call_id) continue;
    const result = turns.find(
      (t) =>
        t.turn_type === "tool_result" &&
        t.tool_call_id === fork.tool_call_id &&
        t.order > fork.order,
    );
    if (result && result.concepts.length === 0) mergeOrders.add(result.order);
  }

  const rows: CascadeRowModel[] = [];
  let pending: CascadeTurn[] = [];
  const isChildSession = depth > 0;
  const firstInput = firstUserInput(turns);

  const flush = () => {
    if (pending.length) {
      rows.push(makePill(pending, sessionId, depth));
      pending = [];
    }
  };

  const spliceChild = (child: CascadeSession, forkPrompt: string | null) => {
    rows.push(makeAgentRow(child, depth + 1, forkPrompt, ctx));
    const childRows = deriveSessionRows(child, depth + 1, ctx);
    // The child's final response is the merge point where its lane curves back.
    const last = childRows[childRows.length - 1];
    if (last && last.kind === "response") last.merge = true;
    rows.push(...childRows);
  };

  for (const turn of turns) {
    if (turn.turn_type === "user_input") {
      // A child's turn-0 prompt lives on its AgentRow, revealed on click.
      if (isChildSession && turn.order === firstInput?.order) continue;
      flush();
      rows.push({
        kind: "user",
        depth,
        sessionId,
        order: turn.order,
        text: turn.content,
        timestamp: turn.timestamp,
      });
      continue;
    }

    if (turn.concepts.length > 0) {
      flush();
      for (const c of turn.concepts) {
        rows.push({
          kind: "concept",
          depth,
          sessionId,
          order: turn.order,
          verb: "READ",
          name: c.name || c.id || c.ref_id,
          refId: c.ref_id || null,
          via: turn.tool,
          timestamp: turn.timestamp,
        });
      }
      continue;
    }

    if (turn.turn_type === "tool_call" && turn.tool === SUB_AGENT_TOOL) {
      flush();
      const child = forkChild.get(turn.order);
      if (child) {
        spliceChild(child, parseForkPrompt(turn.content));
      } else {
        // Fork observed but the child session isn't visible yet (or crashed
        // before its node existed) — render the header rather than omit it.
        rows.push({
          kind: "agent",
          depth: depth + 1,
          sessionId,
          childSessionId: "",
          label: SUB_AGENT_TOOL,
          prompt: parseForkPrompt(turn.content),
          status: "running",
          hasTrace: false,
          timestamp: turn.timestamp,
        });
      }
      continue;
    }

    if (turn.turn_type === "tool_result" && mergeOrders.has(turn.order)) {
      continue;
    }

    if (turn.turn_type === "tool_call" && turn.tool && CREATE_TOOLS[turn.tool]) {
      const label = parseCreatedLabel(turn.content);
      if (label) {
        flush();
        rows.push({
          kind: "concept",
          depth,
          sessionId,
          order: turn.order,
          verb: CREATE_TOOLS[turn.tool],
          name: label,
          refId: null,
          via: turn.tool,
          timestamp: turn.timestamp,
        });
        continue;
      }
      // Unparseable input — fold into the surrounding pill instead.
    }

    if (turn.turn_type === "response") {
      flush();
      rows.push({
        kind: "response",
        depth,
        sessionId,
        order: turn.order,
        text: turn.content,
        merge: false,
        timestamp: turn.timestamp,
      });
      continue;
    }

    pending.push(turn);
  }
  flush();

  // Children with no matching fork turn in the fetched chain (e.g. the fork
  // page hasn't arrived yet) — still shown, appended after the session's rows.
  for (const child of children) {
    if (!splicedChildIds.has(child.id)) spliceChild(child, null);
  }

  // Live head behaviour: the trailing pill of a running session ticks up in
  // place as new turns arrive.
  const last = rows[rows.length - 1];
  if (session.status === "running" && last?.kind === "pill") last.open = true;

  return rows;
}

function isTopLevel(session: CascadeSession): boolean {
  return session.agent_name !== "";
}

function parentIdOf(session: CascadeSession): string | null {
  if (session.parent_session_id) return session.parent_session_id;
  // Children are also discoverable purely by id shape: <parent>-sub-<8hex>.
  const idx = session.id.lastIndexOf("-sub-");
  return idx > 0 ? session.id.slice(0, idx) : null;
}

/** Build the parent → children index from a flat session list. */
export function buildChildrenIndex(
  sessions: CascadeSession[],
): Map<string, CascadeSession[]> {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const childrenOf = new Map<string, CascadeSession[]>();
  for (const s of sessions) {
    if (isTopLevel(s)) continue;
    const parentId = parentIdOf(s);
    if (!parentId || !byId.has(parentId)) continue;
    const list = childrenOf.get(parentId) ?? [];
    list.push(s);
    childrenOf.set(parentId, list);
  }
  return childrenOf;
}

/**
 * Assemble the whole run: one cascade per top-level agent (ordered by start
 * time — that is the agent chain), children nested inside, plus the run-level
 * summary strip numbers.
 */
export function assembleRunCascade(
  sessions: CascadeSession[],
  turnsBySession: Map<string, CascadeTurn[]>,
): RunCascadeModel {
  const topLevel = sessions.filter(isTopLevel).sort(byStartTime);
  const childrenOf = buildChildrenIndex(sessions);
  const ctx: SessionTreeContext = { childrenOf, turnsBySession };

  const runningIds = new Set(
    sessions.filter((s) => s.status === "running").map((s) => s.id),
  );
  const hasRunningDescendant = (id: string): boolean => {
    for (const child of childrenOf.get(id) ?? []) {
      if (runningIds.has(child.id) || hasRunningDescendant(child.id)) return true;
    }
    return false;
  };

  const agents: AgentCascade[] = topLevel.map((session) => ({
    session,
    rows: deriveSessionRows(session, 0, ctx),
    live: runningIds.has(session.id) || hasRunningDescendant(session.id),
  }));

  const conceptKeys = new Set<string>();
  for (const agent of agents) {
    for (const row of agent.rows) {
      if (row.kind === "concept") conceptKeys.add(row.refId ?? `${row.verb}:${row.name}`);
    }
  }

  let toolCalls = 0;
  const sessionIds = new Set(sessions.map((s) => s.id));
  for (const [id, turns] of turnsBySession) {
    if (!sessionIds.has(id)) continue;
    for (const t of turns) if (t.turn_type === "tool_call") toolCalls += 1;
  }

  return {
    agents,
    summary: {
      agents: topLevel.length,
      subAgents: sessions.length - topLevel.length,
      concepts: conceptKeys.size,
      totalTokens: sessions.reduce((sum, s) => sum + (s.token_usage?.total ?? 0), 0),
      toolCalls,
      running: agents.some((a) => a.live),
    },
  };
}
