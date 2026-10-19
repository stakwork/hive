/**
 * Mock answers for the graph workbench's reads (src/services/graph/workbench.ts)
 * under USE_MOCKS: a small concept tree with a node under two parents, one
 * concept outside any tree, and a few non-concept neighbours.
 *
 * Do NOT add Next.js imports — the service calls these.
 */

import type {
  ConnectionGroup,
  ConnectionItem,
  BrainstormRoot,
  ChoiceTreeData,
  ConnectionPageArgs,
  Hierarchy,
  NodeConnections,
} from "@/services/graph/workbench";
import { typeFromLabels } from "@/lib/strut-run-graph/hydrate";

interface MockConcept {
  id: string;
  name: string;
  description: string;
  docs: string;
  repo?: string;
  reads: number;
  approvers: string[];
}

const CONCEPTS: MockConcept[] = [
  {
    id: "concept-glimmer",
    name: "Glimmer (gRLM)",
    description: "Root of the knowledge an agent walks instead of loading it all.",
    docs: "# Glimmer (gRLM)\n\nAgents walk this graph to decide what to know and what to do.",
    reads: 12,
    approvers: ["Dev User"],
  },
  {
    id: "concept-coding",
    name: "Coding",
    description: "Root concept for changing source code.",
    docs: "# Coding\n\nHow to plan, make, verify and review code changes.\n\n- Walk it; don't load it all.",
    reads: 9,
    approvers: ["Dev User"],
  },
  {
    id: "concept-verification",
    name: "Verification",
    description: "Proving a change works.",
    docs: "# Verification\n\nEvidence over assertion.",
    reads: 4,
    approvers: [],
  },
  {
    id: "concept-security-review",
    name: "Security Review",
    description: "Checks for places a caller can do what they should not.",
    docs: "# Security Review\n\nWalk the child concepts; each child is one area of security.",
    reads: 6,
    approvers: ["Dev User"],
  },
  {
    id: "concept-idor",
    name: "IDOR Check",
    description: "Insecure direct object reference.",
    docs: "# IDOR Check\n\nConfirm the caller may use **that specific resource** before it is fetched or changed.",
    reads: 3,
    approvers: [],
  },
  {
    id: "concept-coding-verification",
    name: "Coding Verification",
    description: "The evidence bar for a code change.",
    docs: "# Coding Verification\n\nReport only what you ran, with the command and its exit code.",
    reads: 5,
    approvers: [],
  },
  {
    id: "concept-test-audit",
    name: "Test Audit",
    description: "Finding tests that cannot fail.",
    docs: "# Test Audit\n\nSelf-comparisons and identity copies are junk.",
    reads: 2,
    approvers: [],
  },
  {
    id: "concept-chat-artifacts",
    name: "Chat Artifacts",
    description: "Feature doc generated from the hive repo.",
    docs: "# Chat Artifacts\n\nA message carries artifact refs, read through one loader.",
    repo: "stakwork/hive",
    reads: 0,
    approvers: [],
  },
];

const PARENT_OF: Array<[string, string]> = [
  ["concept-glimmer", "concept-coding"],
  ["concept-glimmer", "concept-verification"],
  ["concept-coding", "concept-security-review"],
  ["concept-coding", "concept-coding-verification"],
  ["concept-verification", "concept-coding-verification"],
  ["concept-security-review", "concept-idor"],
  ["concept-coding-verification", "concept-test-audit"],
];

const RELATED_TO: Array<[string, string]> = [["concept-test-audit", "concept-security-review"]];

/** Non-concept neighbours: a strut tool call that read each concept, and the workspace. */
const toolCall = (conceptId: string) => ({
  id: `toolcall-${conceptId}`,
  name: "graph_graph_get",
  labels: ["Data_Bank", "Node", "Domain_strut", "StrutToolCall"],
});
const WORKSPACE = { id: "hive-workspace-mock", name: "mock-stakgraph", labels: ["Data_Bank", "Node", "HiveWorkspace"] };
const CONCEPT_LABELS = ["Data_Bank", "Node", "Concept"];

interface MockEdge {
  edge: string;
  source: { id: string; name: string; labels: string[] };
  target: { id: string; name: string; labels: string[] };
}

function allEdges(): MockEdge[] {
  const byId = new Map(CONCEPTS.map((c) => [c.id, { id: c.id, name: c.name, labels: CONCEPT_LABELS }]));
  const between = (type: string, pairs: Array<[string, string]>) =>
    pairs.map(([s, t]) => ({ edge: type, source: byId.get(s)!, target: byId.get(t)! }));
  return [
    ...between("PARENT_OF", PARENT_OF),
    ...between("RELATED_TO", RELATED_TO),
    ...CONCEPTS.filter((c) => c.reads > 0).map((c) => ({
      edge: "ACCESSED",
      source: toolCall(c.id),
      target: byId.get(c.id)!,
    })),
    { edge: "HAS_CONCEPT", source: WORKSPACE, target: byId.get("concept-glimmer")! },
  ];
}

/** Any other type: a small tree along CONTAINS, so switching the tree's type and edge has something to show. */
function otherTypeTree(label: string): Hierarchy {
  const id = (suffix: string) => `${label.toLowerCase()}-${suffix}`;
  const node = (suffix: string, name: string) => ({
    id: id(suffix),
    key: null,
    name,
    description: null,
    docs: null,
    repo: null,
    reads: 0,
    approvers: [],
  });
  return {
    nodes: [node("group", `${label} group`), node("a", `${label} A`), node("b", `${label} B`)],
    edges: [
      { type: "CONTAINS", source: id("group"), target: id("a") },
      { type: "CONTAINS", source: id("group"), target: id("b") },
    ],
    truncated: false,
  };
}

export function mockHierarchy(label: string): Hierarchy {
  if (label !== "Concept") return otherTypeTree(label);
  return {
    nodes: CONCEPTS.map((c) => ({
      id: c.id,
      key: `stakwork/hive/${c.id.replace(/^concept-/, "")}`,
      name: c.name,
      description: c.description,
      docs: c.docs,
      repo: c.repo ?? null,
      reads: c.reads,
      approvers: c.approvers,
    })),
    edges: [
      ...PARENT_OF.map(([source, target]) => ({ type: "PARENT_OF", source, target })),
      ...RELATED_TO.map(([source, target]) => ({ type: "RELATED_TO", source, target })),
    ],
    truncated: false,
  };
}

const edgesOf = (id: string) => allEdges().filter((e) => e.source.id === id || e.target.id === id);

export function mockNodeConnections(id: string): NodeConnections {
  const edges = edgesOf(id);
  const c = CONCEPTS.find((x) => x.id === id);
  // A non-concept node is whichever end of its own edges it sits on; anything else
  // (a mock search hit, another type's node) answers as a bare node rather than "not found".
  const self = edges.map((e) => (e.source.id === id ? e.source : e.target))[0];
  const node = c
    ? {
        id,
        type: "Concept",
        name: c.name,
        properties: { ref_id: c.id, name: c.name, description: c.description, docs: c.docs },
      }
    : self
      ? { id, type: typeFromLabels(self.labels), name: self.name, properties: { ref_id: id, name: self.name } }
      : { id, type: "Node", name: id, properties: { ref_id: id, name: id } };

  const groups = new Map<string, ConnectionGroup>();
  for (const e of edges) {
    const outgoing = e.source.id === id;
    const o = outgoing ? e.target : e.source;
    const other = typeFromLabels(o.labels);
    const key = `${e.edge}|${outgoing}|${other}`;
    const g = groups.get(key) ?? { edge: e.edge, outgoing, other, count: 0, items: [] };
    g.count += 1;
    g.items.push({ id: o.id, name: o.name, type: other });
    groups.set(key, g);
  }
  return { node, groups: [...groups.values()] };
}

export function mockConnectionPage({ refId, edge, outgoing, limit }: ConnectionPageArgs): ConnectionItem[] {
  return edgesOf(refId)
    .filter((e) => e.edge === edge && (outgoing ? e.source.id === refId : e.target.id === refId))
    .map((e) => (outgoing ? e.target : e.source))
    .map((o) => ({ id: o.id, name: o.name, type: typeFromLabels(o.labels) }))
    .slice(0, limit);
}

/** A small brainstorm tree under `focus`: a root question with sub-questions 1 and 2, options 1A, 1B, 2A, and under 1A a follow-up question with options 1AA and 1AB. */
export function mockChoiceTree(focus: string, labels: string[] = ["Question", "Option", "Choice"]): ChoiceTreeData {
  if (focus === MOCK_BOARD_ROOT) return mockBoardTree(labels);
  const kid = (n: string) => `${focus}-${n}`;
  const q = (id: string, n: number, text: string, state = "open") =>
    ({ ref_id: id, type: "Question" as const, properties: { question_id: n, text, made_by: "user", state } });
  const o = (id: string, n: number, text: string, state = "open") =>
    ({ ref_id: id, type: "Option" as const, properties: { option_id: n, text, kind: "option", made_by: "model", state } });
  const nodes = [
    q(focus, 1, "Mock question?"),
    q(kid("q1"), 2, "Sub-question one?"),
    q(kid("q2"), 3, "Sub-question two?"),
    o(kid("1a"), 4, "Option 1A"),
    o(kid("1b"), 5, "Option 1B", "rejected"),
    o(kid("2a"), 6, "Option 2A"),
    q(kid("fq"), 7, "Follow-up?"),
    o(kid("1aa"), 8, "Option 1AA"),
    o(kid("1ab"), 9, "Option 1AB"),
  ].filter((n) => labels.includes(n.type));
  const ids = new Set(nodes.map((n) => n.ref_id));
  const edges = [
    [focus, kid("q1")],
    [focus, kid("q2")],
    [kid("q1"), kid("1a")],
    [kid("q1"), kid("1b")],
    [kid("q2"), kid("2a")],
    [kid("1a"), kid("fq")],
    [kid("fq"), kid("1aa")],
    [kid("fq"), kid("1ab")],
  ]
    .map(([source, target]) => ({ source, target }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges, truncated: false };
}

/** The root of the brainstorm board mock (`mockBoardTree`); the first of `mockBrainstormList`. */
export const MOCK_BOARD_ROOT = "mock-brainstorm-board";

/** Three brainstorm roots, newest first; the first is the board mock. */
export function mockBrainstormList(): BrainstormRoot[] {
  return [
    { ref_id: MOCK_BOARD_ROOT, text: "How should teams share brainstorm boards?", job: "job-mock-board", made_by: "user" },
    { ref_id: "mock-brainstorm-pricing", text: "What should the pricing page lead with?", job: "job-mock-pricing", made_by: "model" },
    { ref_id: "mock-brainstorm-onboarding", text: "How do we shorten onboarding?", job: null, made_by: "user" },
  ];
}

/**
 * A board-sized brainstorm tree with every state: a decided root by a person
 * (Tom, with a quote and a job), a decided sub-question with a chosen model
 * option (1A) and a rejected one (1B), an unchosen option with a follow-up
 * branch (1C, a ghost), an open follow-up under 1A with three open options
 * (one by a person, speaker Jamie), and a simulated option with a simulated
 * follow-up question and options.
 */
export function mockBoardTree(labels: string[] = ["Question", "Option", "Choice"]): ChoiceTreeData {
  const R = MOCK_BOARD_ROOT;
  const q = (id: string, n: number, props: Record<string, unknown>) =>
    ({ ref_id: id, type: "Question" as const, properties: { question_id: n, made_by: "model", state: "open", ...props } });
  const o = (id: string, n: number, props: Record<string, unknown>) =>
    ({ ref_id: id, type: "Option" as const, properties: { option_id: n, kind: "option", made_by: "model", state: "open", ...props } });
  const nodes = [
    q(R, 1, {
      text: "How should teams share brainstorm boards?",
      made_by: "user",
      speaker: "Tom",
      quote: "I want the whole team to see where a brainstorm stands without opening a chat.",
      state: "decided",
      criteria: "Teammates see the same tree; no new infrastructure",
      reversibility: "two_way",
      job: "job-mock-board",
    }),
    q("mock-bb-q1", 2, { text: "Where should the board live?", state: "decided", criteria: "Close to the chat, one click away", reversibility: "one_way" }),
    o("mock-bb-1a", 3, { text: "A tab on the org canvas", state: "chosen", criteria: "Reuses the canvas chrome" }),
    o("mock-bb-1b", 4, { text: "A standalone page per brainstorm", state: "rejected" }),
    o("mock-bb-1c", 5, { text: "Only inside the chat", state: "open" }),
    q("mock-bb-1c-q", 6, { text: "Which message holds the card?", criteria: "Stays visible", reversibility: "two_way" }),
    o("mock-bb-1c-a", 7, { text: "Pin the first message" }),
    q("mock-bb-fq", 8, { text: "Who may change the tree?", criteria: "Safe for teammates' work", reversibility: "two_way" }),
    o("mock-bb-fqa", 9, { text: "Anyone in the workspace" }),
    o("mock-bb-fqb", 10, { text: "Only the person who started the job", made_by: "user", speaker: "Jamie" }),
    o("mock-bb-fqc", 11, { text: "The workspace owner approves each change", reversibility: "one_way" }),
    o("mock-bb-fqd", 12, { text: "Live co-editing with cursors", state: "simulated" }),
    q("mock-bb-sim-q", 13, { text: "How do concurrent edits merge?", state: "simulated", criteria: "No lost branches", reversibility: "one_way" }),
    o("mock-bb-sim-a", 14, { text: "Last write wins", state: "simulated" }),
    o("mock-bb-sim-b", 15, { text: "Merge per branch", state: "simulated" }),
  ].filter((n) => labels.includes(n.type));
  const ids = new Set(nodes.map((n) => n.ref_id));
  const edges = [
    [R, "mock-bb-q1"],
    ["mock-bb-q1", "mock-bb-1a"],
    ["mock-bb-q1", "mock-bb-1b"],
    ["mock-bb-q1", "mock-bb-1c"],
    ["mock-bb-1c", "mock-bb-1c-q"],
    ["mock-bb-1c-q", "mock-bb-1c-a"],
    ["mock-bb-1a", "mock-bb-fq"],
    ["mock-bb-fq", "mock-bb-fqa"],
    ["mock-bb-fq", "mock-bb-fqb"],
    ["mock-bb-fq", "mock-bb-fqc"],
    ["mock-bb-fq", "mock-bb-fqd"],
    ["mock-bb-fqd", "mock-bb-sim-q"],
    ["mock-bb-sim-q", "mock-bb-sim-a"],
    ["mock-bb-sim-q", "mock-bb-sim-b"],
  ]
    .map(([source, target]) => ({ source, target }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges, truncated: false };
}
