import { describe, it, expect } from "vitest";
import {
  buildStrutTrace,
  cascadeToolName,
  descendantsOf,
  reasoningByCall,
  topSessions,
  withReasoning,
  type StrutRunEvent,
} from "@/lib/legal-cascade/strut";
import { assembleRunCascade, SUB_AGENT_TOOL } from "@/lib/legal-cascade/derive";

const WF = "harvey-lab-run";
const T = (s: number) => new Date(Date.UTC(2026, 9, 21, 3, 0, s)).toISOString();

/** Shaped like a real `harvey-lab-run` log: an ingest agent that reads, writes and forks a sub-agent. */
const ingest: StrutRunEvent[] = [
  { type: "run.start", path: WF, ts: T(0) },
  {
    type: "step.start",
    path: `${WF}/ingest#0`,
    stepType: "agent",
    ts: T(1),
    input: { prompt: "You are the DOCUMENT INGESTION agent.", model: "claude-sonnet-5" },
  },
  { type: "step.start", path: `${WF}/ingest#0/001-graph_graph_search`, stepType: "tool:graph_graph_search", toolCallId: "c1", ts: T(2), input: { q: "drafting rules" } },
  {
    type: "step.end",
    path: `${WF}/ingest#0/001-graph_graph_search`,
    stepType: "tool:graph_graph_search",
    toolCallId: "c1",
    ts: T(3),
    output: "[3 hits]",
    nodes: [
      { ref_id: "k1", node_type: "Concept", name: "Covenant review" },
      { ref_id: "d1", node_type: "Document", name: "memo.docx" },
    ],
  },
  {
    type: "step.start",
    path: `${WF}/ingest#0/002-graph_create_batch_triplet`,
    stepType: "tool:graph_create_batch_triplet",
    toolCallId: "c2",
    ts: T(4),
    input: { triplets: [{ source_type: "Agreement", source_data: { name: "Credit Agreement" } }] },
  },
  {
    type: "step.end",
    path: `${WF}/ingest#0/002-graph_create_batch_triplet`,
    stepType: "tool:graph_create_batch_triplet",
    toolCallId: "c2",
    ts: T(5),
    output: { succeeded: 1 },
    nodes: [{ ref_id: "a1", node_type: "Agreement", name: "Credit Agreement" }],
  },
  { type: "step.start", path: `${WF}/ingest#0/003-agent`, stepType: "tool:agent", toolCallId: "c3", ts: T(6), input: { prompt: "Check the figures." } },
  { type: "step.start", path: `${WF}/ingest#0/003-agent/001-bash`, stepType: "tool:bash", toolCallId: "s1", ts: T(7), input: { command: "ls" } },
  { type: "step.error", path: `${WF}/ingest#0/003-agent/001-bash`, stepType: "tool:bash", toolCallId: "s1", ts: T(8), error: { message: "timed out" } },
  {
    type: "step.end",
    path: `${WF}/ingest#0/003-agent`,
    stepType: "tool:agent",
    toolCallId: "c3",
    ts: T(9),
    output: { result: "Figures check out." },
    transcript: `/workflows/${WF}/runs/179/transcripts/${WF}/ingest%230/003-agent`,
  },
  {
    type: "step.end",
    path: `${WF}/ingest#0`,
    stepType: "agent",
    ts: T(10),
    output: { result: "Ingested memo.docx." },
    usage: { inputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 5, outputTokens: 20, totalTokens: 135 },
    transcript: `/workflows/${WF}/runs/179/transcripts/${WF}/ingest%230`,
  },
  // A second agent, still working.
  { type: "step.start", path: `${WF}/drafter`, stepType: "agent", ts: T(11), input: { prompt: "You are the DRAFTER agent." } },
  { type: "step.start", path: `${WF}/drafter/001-bash`, stepType: "tool:bash", toolCallId: "d1", ts: T(12), input: { command: "cat facts.md" } },
  // Not an agent's tool call: ignored.
  { type: "step.start", path: `${WF}/score`, stepType: "exec", ts: T(13), input: {} },
];

describe("strut run log → cascade sessions", () => {
  it("names tools in the cascade's vocabulary", () => {
    expect(cascadeToolName("graph_graph_search")).toBe("graph_search");
    expect(cascadeToolName("graph_create_batch_triplet")).toBe("create_batch_triplet");
    expect(cascadeToolName("agent")).toBe(SUB_AGENT_TOOL);
    expect(cascadeToolName("bash")).toBe("bash");
    expect(cascadeToolName("sheets_get_values")).toBe("sheets_get_values");
  });

  it("makes each agent a session and each sub-agent a child of its caller", () => {
    const trace = buildStrutTrace(ingest, WF, false);
    expect(topSessions(trace).map((s) => [s.id, s.status, s.child_count])).toEqual([
      ["ingest#0", "success", 1],
      ["drafter", "running", 0],
    ]);
    const ingest0 = trace.sessions.get("ingest#0")!;
    expect(ingest0.session).toMatchObject({
      agent_name: "ingest#0",
      parent_session_id: "",
      source: "strut",
      model: "claude-sonnet-5",
      timestamp: T(1),
      last_turn_at: Date.parse(T(10)),
      token_usage: { input: 10, cache_read: 100, cache_write: 5, output: 20, total: 135 },
    });
    expect(ingest0.finished).toBe(true);
    expect(ingest0.transcript).toBe(`/workflows/${WF}/runs/179/transcripts/${WF}/ingest%230`);
    expect(descendantsOf(trace, "ingest#0").map((s) => [s.id, s.parent_session_id, s.agent_name, s.status])).toEqual([
      ["ingest#0/003-agent", "ingest#0", "", "success"],
    ]);
  });

  it("orders turns in fixed slots: prompt, then call/result pairs, then the response", () => {
    const turns = buildStrutTrace(ingest, WF, false).sessions.get("ingest#0")!.turns;
    expect(turns.map((t) => [t.order, t.turn_type, t.tool])).toEqual([
      [0, "user_input", null],
      [2, "tool_call", "graph_search"],
      [3, "tool_result", "graph_search"],
      [5, "tool_call", "create_batch_triplet"],
      [6, "tool_result", "create_batch_triplet"],
      [8, "tool_call", SUB_AGENT_TOOL],
      [9, "tool_result", SUB_AGENT_TOOL],
      [10, "response", null],
    ]);
    expect(turns[0].content).toBe("You are the DOCUMENT INGESTION agent.");
    // A read reports the Concepts it touched, never the other node types.
    expect(turns[2].concepts).toEqual([{ ref_id: "k1", id: null, name: "Covenant review" }]);
    // A write is labelled by the node it reported.
    expect(JSON.parse(turns[3].content)).toMatchObject({ name: "Credit Agreement" });
    expect(turns[4].concepts).toEqual([]);
    expect(turns.at(-1)!.content).toBe("Ingested memo.docx.");
  });

  it("gives a sub-agent its prompt, its calls and an error as a result", () => {
    const turns = buildStrutTrace(ingest, WF, false).sessions.get("ingest#0/003-agent")!.turns;
    expect(turns.map((t) => [t.order, t.turn_type, t.content])).toEqual([
      [0, "user_input", "Check the figures."],
      [2, "tool_call", '{"command":"ls"}'],
      [3, "tool_result", "Error: timed out"],
      [4, "response", "Figures check out."],
    ]);
  });

  it("calls an agent with no end aborted once the run is over", () => {
    const trace = buildStrutTrace(ingest, WF, true);
    expect(trace.sessions.get("drafter")!.session.status).toBe("aborted");
    expect(trace.sessions.get("drafter")!.finished).toBe(true);
  });

  it("starts a re-run agent's session afresh", () => {
    const again: StrutRunEvent[] = [
      ...ingest,
      { type: "step.start", path: `${WF}/ingest#0`, stepType: "agent", ts: T(20), input: { prompt: "Second attempt." } },
    ];
    const s = buildStrutTrace(again, WF, false).sessions.get("ingest#0")!;
    expect(s.session.status).toBe("running");
    expect(s.turns.map((t) => t.content)).toEqual(["Second attempt."]);
  });

  it("puts each reasoning text in the slot before the call it led to", () => {
    const transcript = [
      { role: "system", content: "sys" },
      { role: "user", content: "prompt" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Search first." },
          { type: "tool-call", toolCallId: "c1", toolName: "graph_graph_search", input: {} },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", output: {} }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Now write it." },
          { type: "tool-call", toolCallId: "c2", toolName: "graph_create_batch_triplet", input: {} },
          { type: "tool-call", toolCallId: "c3", toolName: "agent", input: {} },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ];
    const byCall = reasoningByCall(transcript);
    expect([...byCall]).toEqual([
      ["c1", "Search first."],
      ["c2", "Now write it."],
    ]);
    const turns = withReasoning(buildStrutTrace(ingest, WF, false).sessions.get("ingest#0")!.turns, byCall);
    expect(turns.filter((t) => t.turn_type === "reasoning").map((t) => [t.order, t.content])).toEqual([
      [1, "Search first."],
      [4, "Now write it."],
    ]);
    expect(reasoningByCall("nope").size).toBe(0);
  });

  it("assembles into the cascade the legal Traces view renders", () => {
    const trace = buildStrutTrace(ingest, WF, false);
    const turnsBy = new Map([...trace.sessions].map(([id, s]) => [id, s.turns]));
    const model = assembleRunCascade([...topSessions(trace), ...descendantsOf(trace, "ingest#0")], turnsBy);
    expect(model.summary).toMatchObject({ agents: 2, subAgents: 1, toolCalls: 5, running: true });
    const ingestRows = model.agents.find((a) => a.session.id === "ingest#0")!.rows;
    // The search call folds into a pill, its result's Concept is a READ row,
    // the write is a CREATED row, the sub-agent a lane ending in its response.
    expect(ingestRows.map((r) => (r.kind === "concept" ? `${r.kind}:${r.verb}:${r.name}` : r.kind))).toEqual([
      "user",
      "pill",
      "concept:READ:Covenant review",
      "concept:CREATED:Credit Agreement",
      "pill",
      "agent",
      "pill",
      "response",
      "response",
    ]);
  });
});
