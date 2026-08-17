import type {
  CascadeSession,
  CascadeSessionDetail,
  CascadeTurn,
  CascadeTurnsPage,
} from "./types";

/**
 * Deterministic mock run for USE_MOCKS mode and tests: two top-level agents,
 * one sub-agent, concept READs and a display-parsed CREATED — small enough to
 * eyeball, complete enough to exercise every row kind (user, pill, concept,
 * fork/merge, response).
 */

const T0 = 1755449000000;

export const MOCK_PLAN_SESSION_ID = "b0e35724-4f39-49b5-9394-5037a4931bf5";
export const MOCK_PLAN_CHILD_ID = `${MOCK_PLAN_SESSION_ID}-sub-a1b2c3d4`;
export const MOCK_REPAIR_SESSION_ID = "c1f46835-5a4a-5ac6-a4a5-6148b5a42c06";

const CHILD_PROMPT =
  "Map every clause in the Q3 vendor contracts to WFA ontology types. Report unmatched clauses with ref_ids.";

function session(overrides: Partial<CascadeSession> & { id: string }): CascadeSession {
  return {
    parent_session_id: "",
    agent_name: "",
    source: "repo_agent",
    status: "success",
    turn_count: 0,
    last_turn_at: null,
    timestamp: new Date(T0).toISOString(),
    model: "claude-sonnet-5",
    repo: "stakwork/hive",
    token_usage: { input: 0, cache_read: 0, cache_write: 0, output: 0, total: 0 },
    child_count: 0,
    ...overrides,
  };
}

function turn(
  sessionId: string,
  overrides: Partial<CascadeTurn> & { order: number; turn_type: CascadeTurn["turn_type"] },
): CascadeTurn {
  return {
    turn_id: `${sessionId}-turn-${overrides.order}`,
    tool: null,
    tool_call_id: null,
    content: "",
    timestamp: T0 + overrides.order * 5000,
    concepts: [],
    ...overrides,
  };
}

/** Top-level sessions of the mock run, as the agent_name filter returns them. */
export function buildMockCascadeSessions(identifier: string): CascadeSession[] {
  return [
    session({
      id: MOCK_PLAN_SESSION_ID,
      agent_name: `plan-agent-${identifier}`,
      turn_count: 9,
      last_turn_at: T0 + 8 * 5000,
      timestamp: new Date(T0).toISOString(),
      token_usage: { input: 120000, cache_read: 80000, cache_write: 0, output: 9000, total: 209000 },
      child_count: 1,
    }),
    session({
      id: MOCK_REPAIR_SESSION_ID,
      agent_name: `repair-agent-${identifier}`,
      turn_count: 5,
      last_turn_at: T0 + 120000 + 4 * 5000,
      timestamp: new Date(T0 + 120000).toISOString(),
      token_usage: { input: 60000, cache_read: 30000, cache_write: 0, output: 4000, total: 94000 },
    }),
  ];
}

function mockChildSession(): CascadeSession {
  return session({
    id: MOCK_PLAN_CHILD_ID,
    parent_session_id: MOCK_PLAN_SESSION_ID,
    source: "graph_sub_agent",
    turn_count: 4,
    last_turn_at: T0 + 15000 + 3 * 5000,
    timestamp: new Date(T0 + 15000).toISOString(),
    token_usage: { input: 40000, cache_read: 20000, cache_write: 0, output: 3000, total: 63000 },
  });
}

const MOCK_TURNS: Record<string, CascadeTurn[]> = {
  [MOCK_PLAN_SESSION_ID]: [
    turn(MOCK_PLAN_SESSION_ID, {
      order: 0,
      turn_type: "user_input",
      content:
        "Ingest the Q3 vendor contracts and map every clause to the WFA ontology. Reuse existing Concepts where they apply.",
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 1,
      turn_type: "reasoning",
      content: "Loading the ontology and scanning for existing contract Concepts…",
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 2,
      turn_type: "tool_call",
      tool: "stakgraph_search",
      tool_call_id: "c1",
      content: '{"query":"contract clause types"}',
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 3,
      turn_type: "tool_result",
      tool: "stakgraph_search",
      tool_call_id: "c1",
      content: '{"type":"json","value":{"matches":7}}',
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 4,
      turn_type: "tool_call",
      tool: "graph_get",
      tool_call_id: "c2",
      content: '{"ref_id":"onto-1"}',
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 5,
      turn_type: "tool_result",
      tool: "graph_get",
      tool_call_id: "c2",
      content: '{"type":"json","value":{"name":"wfa-ontology"}}',
      concepts: [{ ref_id: "onto-1", id: "g-1", name: "wfa-ontology" }],
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 6,
      turn_type: "tool_call",
      tool: "graph_sub_agent",
      tool_call_id: "c3",
      content: JSON.stringify({ prompt: CHILD_PROMPT }),
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 7,
      turn_type: "tool_result",
      tool: "graph_sub_agent",
      tool_call_id: "c3",
      content: '{"type":"text","value":"Clause map complete: 61 of 74 clau',
    }),
    turn(MOCK_PLAN_SESSION_ID, {
      order: 8,
      turn_type: "response",
      content:
        "Clause map complete: 61 of 74 clauses match existing Concepts. 13 unmatched clauses reported for triage.",
    }),
  ],
  [MOCK_PLAN_CHILD_ID]: [
    turn(MOCK_PLAN_CHILD_ID, {
      order: 0,
      turn_type: "user_input",
      content: CHILD_PROMPT,
    }),
    turn(MOCK_PLAN_CHILD_ID, {
      order: 1,
      turn_type: "tool_call",
      tool: "graph_get_batched",
      tool_call_id: "c1",
      content: '{"ref_ids":["cl-1","cl-2"]}',
    }),
    turn(MOCK_PLAN_CHILD_ID, {
      order: 2,
      turn_type: "tool_result",
      tool: "graph_get_batched",
      tool_call_id: "c1",
      content: '{"type":"json","value":{"nodes":2}}',
      concepts: [{ ref_id: "cc-1", id: "g-2", name: "contract-clauses" }],
    }),
    turn(MOCK_PLAN_CHILD_ID, {
      order: 3,
      turn_type: "response",
      content: "61 of 74 clauses match existing Concepts; 13 have no home.",
    }),
  ],
  [MOCK_REPAIR_SESSION_ID]: [
    turn(MOCK_REPAIR_SESSION_ID, {
      order: 0,
      turn_type: "user_input",
      content: "Model the unmatched indemnification clauses as new Concepts.",
    }),
    turn(MOCK_REPAIR_SESSION_ID, {
      order: 1,
      turn_type: "reasoning",
      content: "Two clause families need a Concept of their own.",
    }),
    turn(MOCK_REPAIR_SESSION_ID, {
      order: 2,
      turn_type: "tool_call",
      tool: "create_triplet",
      tool_call_id: "c1",
      content: JSON.stringify({
        node_type: "Concept",
        node_data: { name: "indemnification-scope" },
      }),
    }),
    turn(MOCK_REPAIR_SESSION_ID, {
      order: 3,
      turn_type: "tool_result",
      tool: "create_triplet",
      tool_call_id: "c1",
      content: '{"type":"json","value":{"ok":true}}',
    }),
    turn(MOCK_REPAIR_SESSION_ID, {
      order: 4,
      turn_type: "response",
      content: "Created indemnification-scope and linked 13 clauses under it.",
    }),
  ],
};

/** Every session in the mock run (top-level + descendants), keyed by id. */
export function buildMockSessionMap(identifier: string): Map<string, CascadeSession> {
  const all = [...buildMockCascadeSessions(identifier), mockChildSession()];
  return new Map(all.map((s) => [s.id, s]));
}

export function buildMockSessionDetail(
  identifier: string,
  sessionId: string,
  recursive: boolean,
): CascadeSessionDetail | null {
  const map = buildMockSessionMap(identifier);
  const found = map.get(sessionId);
  if (!found) return null;
  const descendants = [...map.values()].filter(
    (s) => s.parent_session_id === sessionId,
  );
  return recursive ? { ...found, descendants } : { ...found };
}

export function buildMockSessionTurns(
  identifier: string,
  sessionId: string,
  after: number,
): CascadeTurnsPage | null {
  const map = buildMockSessionMap(identifier);
  const found = map.get(sessionId);
  if (!found) return null;
  const turns = (MOCK_TURNS[sessionId] ?? []).filter((t) => t.order > after);
  return {
    session_id: sessionId,
    status: found.status,
    turn_count: found.turn_count,
    last_turn_at: found.last_turn_at,
    turns,
  };
}

/** Full turn chains for tests. */
export function buildMockTurnsBySession(): Map<string, CascadeTurn[]> {
  return new Map(Object.entries(MOCK_TURNS).map(([id, turns]) => [id, [...turns]]));
}
