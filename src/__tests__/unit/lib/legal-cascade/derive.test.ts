import { describe, it, expect } from "vitest";
import {
  assembleRunCascade,
  deriveSessionRows,
  mergeTurns,
  parseCreatedLabel,
  buildChildrenIndex,
  type SessionTreeContext,
} from "@/lib/legal-cascade/derive";
import type {
  CascadeSession,
  CascadeTurn,
  PillRow,
  AgentRow,
  ConceptRow,
  ResponseRow,
} from "@/lib/legal-cascade/types";
import {
  buildMockCascadeSessions,
  buildMockSessionMap,
  buildMockTurnsBySession,
  MOCK_PLAN_SESSION_ID,
  MOCK_PLAN_CHILD_ID,
  MOCK_REPAIR_SESSION_ID,
} from "@/lib/legal-cascade/fixtures";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<CascadeSession> & { id: string }): CascadeSession {
  return {
    parent_session_id: "",
    agent_name: "agent-x-147813394",
    source: "repo_agent",
    status: "success",
    turn_count: 0,
    last_turn_at: null,
    timestamp: "2026-08-17T18:00:00.000Z",
    model: null,
    repo: null,
    token_usage: null,
    child_count: 0,
    ...overrides,
  };
}

function makeTurn(
  overrides: Partial<CascadeTurn> & { order: number; turn_type: CascadeTurn["turn_type"] },
): CascadeTurn {
  return {
    turn_id: `t-${overrides.order}`,
    tool: null,
    tool_call_id: null,
    content: "",
    timestamp: 1755449000000 + overrides.order * 1000,
    concepts: [],
    ...overrides,
  };
}

function emptyCtx(turns: Map<string, CascadeTurn[]>): SessionTreeContext {
  return { childrenOf: new Map(), turnsBySession: turns };
}

// ─── mergeTurns ───────────────────────────────────────────────────────────────

describe("mergeTurns", () => {
  it("dedupes by order with later pages winning, sorted ascending", () => {
    const a = [
      makeTurn({ order: 2, turn_type: "reasoning", content: "old" }),
      makeTurn({ order: 0, turn_type: "user_input" }),
    ];
    const b = [
      makeTurn({ order: 2, turn_type: "reasoning", content: "new" }),
      makeTurn({ order: 1, turn_type: "tool_call", tool: "x" }),
    ];
    const merged = mergeTurns(a, b);
    expect(merged.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(merged[2].content).toBe("new");
  });

  it("returns existing array untouched for an empty page", () => {
    const a = [makeTurn({ order: 0, turn_type: "user_input" })];
    expect(mergeTurns(a, [])).toBe(a);
  });
});

// ─── parseCreatedLabel ────────────────────────────────────────────────────────

describe("parseCreatedLabel", () => {
  it("prefers node_data.name", () => {
    expect(
      parseCreatedLabel(
        JSON.stringify({ node_type: "Concept", node_data: { name: "indemnification-scope" } }),
      ),
    ).toBe("indemnification-scope");
  });

  it("falls back to name, then node_type", () => {
    expect(parseCreatedLabel(JSON.stringify({ name: "top-name" }))).toBe("top-name");
    expect(parseCreatedLabel(JSON.stringify({ node_type: "Concept" }))).toBe("Concept");
  });

  it("labels batch inputs from the first entry", () => {
    expect(
      parseCreatedLabel(
        JSON.stringify({ triplets: [{ node_data: { name: "clause-family" } }, {}] }),
      ),
    ).toBe("clause-family");
  });

  it("returns null for unparseable or unlabellable content", () => {
    expect(parseCreatedLabel("not json")).toBeNull();
    expect(parseCreatedLabel(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseCreatedLabel(JSON.stringify({ name: "  " }))).toBeNull();
  });
});

// ─── Folding one session ──────────────────────────────────────────────────────

describe("deriveSessionRows — folding", () => {
  it("folds user / pill / concept / response with honest pill spans", () => {
    const s = makeSession({ id: "s1", turn_count: 7 });
    const turns = [
      makeTurn({ order: 0, turn_type: "user_input", content: "Do the thing" }),
      makeTurn({ order: 1, turn_type: "reasoning", content: "Scanning…" }),
      makeTurn({ order: 2, turn_type: "tool_call", tool: "graph_search", tool_call_id: "a" }),
      makeTurn({ order: 3, turn_type: "tool_result", tool: "graph_search", tool_call_id: "a" }),
      makeTurn({ order: 4, turn_type: "tool_call", tool: "graph_get", tool_call_id: "b" }),
      makeTurn({
        order: 5,
        turn_type: "tool_result",
        tool: "graph_get",
        tool_call_id: "b",
        concepts: [{ ref_id: "r1", id: "g1", name: "wfa-ontology" }],
      }),
      makeTurn({ order: 6, turn_type: "response", content: "Done." }),
    ];
    const rows = deriveSessionRows(s, 0, emptyCtx(new Map([["s1", turns]])));

    expect(rows.map((r) => r.kind)).toEqual(["user", "pill", "concept", "response"]);
    const pill = rows[1] as PillRow;
    expect(pill.o0).toBe(1);
    expect(pill.o1).toBe(4);
    expect(pill.calls).toBe(2);
    expect(pill.texts).toEqual(["Scanning…"]);
    expect(pill.mix).toBe("graph_search ×1 · graph_get ×1");
    expect(pill.durationMs).toBe(3000);
    expect(pill.turns).toHaveLength(4);

    const concept = rows[2] as ConceptRow;
    expect(concept.verb).toBe("READ");
    expect(concept.name).toBe("wfa-ontology");
    expect(concept.refId).toBe("r1");
    expect(concept.via).toBe("graph_get");
  });

  it("emits one concept row per concept on a multi-concept turn", () => {
    const s = makeSession({ id: "s1" });
    const turns = [
      makeTurn({
        order: 0,
        turn_type: "tool_result",
        tool: "graph_get_batched",
        concepts: [
          { ref_id: "r1", id: null, name: "a" },
          { ref_id: "r2", id: null, name: "b" },
        ],
      }),
    ];
    const rows = deriveSessionRows(s, 0, emptyCtx(new Map([["s1", turns]])));
    expect(rows.map((r) => r.kind)).toEqual(["concept", "concept"]);
  });

  it("parses create tool_calls into CREATED/EDITED rows; unparseable input folds into the pill", () => {
    const s = makeSession({ id: "s1" });
    const turns = [
      makeTurn({
        order: 0,
        turn_type: "tool_call",
        tool: "create_triplet",
        content: JSON.stringify({ node_data: { name: "new-concept" } }),
      }),
      makeTurn({
        order: 1,
        turn_type: "tool_call",
        tool: "edit_node",
        content: JSON.stringify({ name: "edited-concept" }),
      }),
      makeTurn({ order: 2, turn_type: "tool_call", tool: "create_node", content: "garbage{" }),
    ];
    const rows = deriveSessionRows(s, 0, emptyCtx(new Map([["s1", turns]])));
    expect(rows.map((r) => r.kind)).toEqual(["concept", "concept", "pill"]);
    expect((rows[0] as ConceptRow).verb).toBe("CREATED");
    expect((rows[1] as ConceptRow).verb).toBe("EDITED");
    expect((rows[2] as PillRow).o0).toBe(2);
  });

  it("marks the trailing pill of a running session as open (live head)", () => {
    const s = makeSession({ id: "s1", status: "running" });
    const turns = [
      makeTurn({ order: 0, turn_type: "user_input", content: "go" }),
      makeTurn({ order: 1, turn_type: "tool_call", tool: "bash" }),
    ];
    const rows = deriveSessionRows(s, 0, emptyCtx(new Map([["s1", turns]])));
    expect((rows[1] as PillRow).open).toBe(true);
  });

  it("renders blank-timestamp (backfilled) turns without faking times", () => {
    const s = makeSession({ id: "s1" });
    const turns = [
      makeTurn({ order: 0, turn_type: "user_input", content: "go", timestamp: null }),
      makeTurn({ order: 1, turn_type: "tool_call", tool: "bash", timestamp: null }),
      makeTurn({ order: 2, turn_type: "tool_result", tool: "bash", timestamp: null }),
    ];
    const rows = deriveSessionRows(s, 0, emptyCtx(new Map([["s1", turns]])));
    expect(rows[0].timestamp).toBeNull();
    expect((rows[1] as PillRow).durationMs).toBeNull();
  });
});

// ─── Fork / merge joining ─────────────────────────────────────────────────────

function forkFixture(childPromptInChain: string) {
  const parent = makeSession({ id: "p1", turn_count: 4, timestamp: "2026-08-17T18:00:00.000Z" });
  const child = makeSession({
    id: "p1-sub-a1b2c3d4",
    parent_session_id: "p1",
    agent_name: "",
    source: "graph_sub_agent",
    turn_count: 2,
    timestamp: "2026-08-17T18:00:10.000Z",
  });
  const parentTurns = [
    makeTurn({ order: 0, turn_type: "user_input", content: "go" }),
    makeTurn({
      order: 1,
      turn_type: "tool_call",
      tool: "graph_sub_agent",
      tool_call_id: "f1",
      content: JSON.stringify({ prompt: "Classify the clauses" }),
    }),
    makeTurn({ order: 2, turn_type: "tool_result", tool: "graph_sub_agent", tool_call_id: "f1" }),
    makeTurn({ order: 3, turn_type: "response", content: "parent done" }),
  ];
  const childTurns = [
    makeTurn({ order: 0, turn_type: "user_input", content: childPromptInChain }),
    makeTurn({ order: 1, turn_type: "response", content: "child done" }),
  ];
  const turnsBySession = new Map([
    ["p1", parentTurns],
    ["p1-sub-a1b2c3d4", childTurns],
  ]);
  const ctx: SessionTreeContext = {
    childrenOf: buildChildrenIndex([parent, child]),
    turnsBySession,
  };
  return { parent, child, ctx };
}

describe("deriveSessionRows — fork/merge", () => {
  it("joins a fork to its child by prompt and splices the child between fork and merge", () => {
    const { parent, ctx } = forkFixture("Classify the clauses");
    const rows = deriveSessionRows(parent, 0, ctx);

    expect(rows.map((r) => r.kind)).toEqual(["user", "agent", "response", "response"]);
    const agent = rows[1] as AgentRow;
    expect(agent.childSessionId).toBe("p1-sub-a1b2c3d4");
    expect(agent.depth).toBe(1);
    expect(agent.prompt).toBe("Classify the clauses");
    expect(agent.hasTrace).toBe(true);

    // Child's own rows on the next lane; its turn-0 prompt is NOT a user row.
    const childResponse = rows[2] as ResponseRow;
    expect(childResponse.sessionId).toBe("p1-sub-a1b2c3d4");
    expect(childResponse.depth).toBe(1);
    expect(childResponse.merge).toBe(true);

    const parentResponse = rows[3] as ResponseRow;
    expect(parentResponse.depth).toBe(0);
    expect(parentResponse.merge).toBe(false);
  });

  it("consumes the merge tool_result — it appears in no pill and no row", () => {
    const { parent, ctx } = forkFixture("Classify the clauses");
    const rows = deriveSessionRows(parent, 0, ctx);
    const pillOrders = rows
      .filter((r): r is PillRow => r.kind === "pill")
      .flatMap((p) => p.turns.map((t) => t.order));
    expect(pillOrders).not.toContain(2);
  });

  it("falls back to start-time order when the prompt text does not match", () => {
    const { parent, ctx } = forkFixture("different text entirely");
    const rows = deriveSessionRows(parent, 0, ctx);
    const agent = rows.find((r): r is AgentRow => r.kind === "agent");
    expect(agent?.childSessionId).toBe("p1-sub-a1b2c3d4");
  });

  it("renders a placeholder fork header when the child session is not visible yet", () => {
    const { parent, ctx } = forkFixture("Classify the clauses");
    ctx.childrenOf = new Map(); // child session not listed yet
    const rows = deriveSessionRows(parent, 0, ctx);
    const agent = rows.find((r): r is AgentRow => r.kind === "agent");
    expect(agent).toBeDefined();
    expect(agent?.childSessionId).toBe("");
    expect(agent?.hasTrace).toBe(false);
    expect(agent?.prompt).toBe("Classify the clauses");
  });

  it("renders an empty-chain child as a no-trace agent header instead of omitting the fork", () => {
    const { parent, child, ctx } = forkFixture("Classify the clauses");
    child.turn_count = 0;
    ctx.turnsBySession.delete(child.id);
    const rows = deriveSessionRows(parent, 0, ctx);
    const agent = rows.find((r): r is AgentRow => r.kind === "agent");
    expect(agent?.childSessionId).toBe(child.id);
    expect(agent?.hasTrace).toBe(false);
  });

  it("appends children that matched no fork turn so they are never lost", () => {
    const { parent, child, ctx } = forkFixture("Classify the clauses");
    // Strip the fork/merge turns from the parent chain entirely.
    ctx.turnsBySession.set("p1", [
      makeTurn({ order: 0, turn_type: "user_input", content: "go" }),
      makeTurn({ order: 3, turn_type: "response", content: "parent done" }),
    ]);
    const rows = deriveSessionRows(parent, 0, ctx);
    const agent = rows.find((r): r is AgentRow => r.kind === "agent");
    expect(agent?.childSessionId).toBe(child.id);
  });
});

// ─── Run assembly ─────────────────────────────────────────────────────────────

describe("assembleRunCascade", () => {
  const identifier = "147813394";

  function fullFixture() {
    const sessions = [...buildMockSessionMap(identifier).values()];
    return assembleRunCascade(sessions, buildMockTurnsBySession());
  }

  it("orders top-level agents by start time and nests the child inside the first", () => {
    const model = fullFixture();
    expect(model.agents.map((a) => a.session.id)).toEqual([
      MOCK_PLAN_SESSION_ID,
      MOCK_REPAIR_SESSION_ID,
    ]);
    const planKinds = model.agents[0].rows.map((r) => r.kind);
    expect(planKinds).toEqual([
      "user",
      "pill",
      "concept",
      "agent",
      "pill",
      "concept",
      "response",
      "response",
    ]);
    const childRows = model.agents[0].rows.filter(
      (r) => r.sessionId === MOCK_PLAN_CHILD_ID,
    );
    expect(childRows.length).toBeGreaterThan(0);
    expect(childRows.every((r) => r.depth === 1)).toBe(true);
  });

  it("computes the run-level summary strip numbers", () => {
    const model = fullFixture();
    expect(model.summary.agents).toBe(2);
    expect(model.summary.subAgents).toBe(1);
    // wfa-ontology, contract-clauses (READ) + indemnification-scope (CREATED)
    expect(model.summary.concepts).toBe(3);
    // plan: 3 tool_calls (incl. fork) · child: 1 · repair: 1
    expect(model.summary.toolCalls).toBe(5);
    expect(model.summary.totalTokens).toBe(209000 + 94000 + 63000);
    expect(model.summary.running).toBe(false);
  });

  it("flags an agent live when a descendant is still running", () => {
    const sessions = [...buildMockSessionMap(identifier).values()].map((s) =>
      s.id === MOCK_PLAN_CHILD_ID ? { ...s, status: "running" as const } : s,
    );
    const model = assembleRunCascade(sessions, buildMockTurnsBySession());
    expect(model.agents[0].live).toBe(true);
    expect(model.summary.running).toBe(true);
  });

  it("ignores turn chains for sessions outside the run", () => {
    const turns = buildMockTurnsBySession();
    turns.set("foreign-session", [
      makeTurn({ order: 0, turn_type: "tool_call", tool: "bash" }),
    ]);
    const sessions = [...buildMockSessionMap(identifier).values()];
    expect(assembleRunCascade(sessions, turns).summary.toolCalls).toBe(5);
  });

  it("is incremental-friendly: turns fed in two batches equal one batch", () => {
    const sessions = [...buildMockSessionMap(identifier).values()];
    const full = buildMockTurnsBySession();

    const batched = new Map<string, ReturnType<typeof mergeTurns>>();
    for (const [id, turns] of full) {
      const mid = Math.ceil(turns.length / 2);
      // Overlapping batches on purpose — dedupe by order must absorb it.
      const first = turns.slice(0, mid + 1);
      const second = turns.slice(mid - 1);
      batched.set(id, mergeTurns(mergeTurns([], first), second));
    }

    expect(assembleRunCascade(sessions, batched)).toEqual(
      assembleRunCascade(sessions, full),
    );
  });

  it("groups top-level agents into parallel-launch batches by start-time window", () => {
    // Agents launch in parallel batches: four sessions with consecutive ids
    // starting within ~220ms is normal. Siblings share a batchIndex.
    const t0 = Date.parse("2026-08-17T18:00:00.000Z");
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    const sessions = [
      makeSession({ id: "a", agent_name: "ingest-agent-1", timestamp: at(0) }),
      makeSession({ id: "b", agent_name: "map-agent-1", timestamp: at(220) }),
      makeSession({ id: "c", agent_name: "audit-agent-1", timestamp: at(900) }),
      makeSession({ id: "d", agent_name: "repair-agent-1", timestamp: at(60_000) }),
    ];
    const model = assembleRunCascade(sessions, new Map());
    expect(model.agents.map((a) => a.session.id)).toEqual(["a", "b", "c", "d"]);
    expect(model.agents.map((a) => a.batchIndex)).toEqual([0, 0, 0, 1]);
  });

  it("dedupes a transiently repeated session id, keeping the row with more turns", () => {
    // Known upstream state: a session can appear twice in /api/sessions until
    // repo2graph's dedupe pass runs on its next boot.
    const dupe = makeSession({
      id: "dup-1",
      agent_name: "plan-agent-1",
      turn_count: 3,
    });
    const fresher = { ...dupe, turn_count: 9 };
    const model = assembleRunCascade([dupe, fresher], new Map());
    expect(model.agents).toHaveLength(1);
    expect(model.summary.agents).toBe(1);
    expect(model.agents[0].session.turn_count).toBe(9);
  });

  it("top-level list alone (no descendants fetched yet) still renders", () => {
    const model = assembleRunCascade(
      buildMockCascadeSessions(identifier),
      new Map(),
    );
    expect(model.agents).toHaveLength(2);
    expect(model.summary.subAgents).toBe(0);
    expect(model.agents[0].rows).toEqual([]);
  });
});
