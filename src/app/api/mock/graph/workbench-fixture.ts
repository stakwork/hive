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
  ChoiceEffect,
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


const fx = (id: string, direction: "pro" | "con", name: string, description: string, impact: number | null): ChoiceEffect =>
  ({ ref_id: id, direction, name, description, impact });

/** Mock effects by option id; every option not listed has none. */
const MOCK_EFFECTS: Record<string, ChoiceEffect[]> = {
  "mock-bb-1a": [
    fx("fx-bb-1a-1", "pro", "Reuses canvas chrome", "Filters, workspace switcher and auth come for free.", 0.7),
    fx("fx-bb-1a-2", "pro", "One click from chat", "The tab sits next to the chat that started the job.", 0.5),
    fx("fx-bb-1a-3", "con", "Crowds the canvas tabs", "Another tab competes for space on small screens.", 0.25),
  ],
  "mock-bb-1b": [fx("fx-bb-1b-1", "con", "New route to maintain", "A page of its own needs navigation, auth and tests.", 0.6)],
  "mock-bb-fqa": [
    fx("fx-bb-fqa-1", "pro", "No gatekeeping", "Anyone can fix a wrong branch right away.", 0.65),
    fx("fx-bb-fqa-2", "con", "Accidental deletions", "A teammate may remove a branch someone still needs.", 0.8),
  ],
  "mock-bb-fqc": [fx("fx-bb-fqc-1", "pro", "Clear accountability", "One person answers for the tree.", 0.55)],
  "mock-bl-q2-b": [
    fx("fx-bl-q2-b-1", "pro", "Low noise", "Developers only see comments on code that matters.", 0.8),
    fx("fx-bl-q2-b-2", "pro", "Never blocks a merge", "Advisory only, so urgent PRs are not slowed down.", 0.45),
    fx("fx-bl-q2-b-3", "con", "Tagging upkeep", "Someone must keep the sensitive-path tags current.", 0.2),
  ],
  "mock-bl-q2-a": [
    fx("fx-bl-q2-a-1", "pro", "Covers every push", "Nothing slips past because a path was untagged.", 0.7),
    fx("fx-bl-q2-a-2", "con", "Adds CI minutes", "Every push waits on one more required job.", 0.6),
    fx("fx-bl-q2-a-3", "con", "Comment fatigue", "A summary on every PR gets ignored over time.", 0.35),
  ],
  "mock-bl-q4-b": [
    fx("fx-bl-q4-b-1", "pro", "Understands intent", "Catches weakening changes no static rule describes.", 0.75),
    fx("fx-bl-q4-b-2", "con", "Verdicts can be wrong", "False alarms erode trust in the check.", 0.65),
  ],
  "mock-bl-q4-c": [fx("fx-bl-q4-c-1", "pro", "Grounded in real incidents", "Patterns come from fixes we already made.", 0.6)],
  "mock-bl-q5-c": [
    fx("fx-bl-q5-c-1", "pro", "One weekly view", "Speed and misses read side by side.", 0.7),
    fx("fx-bl-q5-c-2", "con", "Needs a dashboard", "Someone has to build and own it.", null),
  ],
};

function withMockEffects<T extends { ref_id: string; effects?: ChoiceEffect[] }>(nodes: T[], extra: Record<string, ChoiceEffect[]> = {}): T[] {
  const all = { ...MOCK_EFFECTS, ...extra };
  return nodes.map((n) => (all[n.ref_id] ? { ...n, effects: all[n.ref_id] } : n));
}

/** A small brainstorm tree under `focus`: a root question with sub-questions 1 and 2, options 1A, 1B, 2A, and under 1A a follow-up question with options 1AA and 1AB. */
export function mockChoiceTree(focus: string, labels: string[] = ["Question", "Option", "Choice"]): ChoiceTreeData {
  const data = mockChoiceTreeUndated(focus, labels);
  const days = MOCK_DAYS_AGO[focus] ?? mockDaysAgoOf(focus);
  const ms = Date.now() - days * 86400000 - 3600000;
  // The live graph stamps `date_added_to_graph` in epoch milliseconds; older nodes used seconds,
  // so the legacy mock brainstorm keeps seconds. The desk's timeline reads either.
  const at = days >= LEGACY_SECONDS_DAYS_AGO ? Math.floor(ms / 1000) : ms;
  return {
    ...data,
    nodes: data.nodes.map((n) => ({ ...n, properties: { date_added_to_graph: at, ...n.properties } })),
  };
}

/** How many days ago each mock brainstorm was added, for the desk's timeline. */
const MOCK_DAYS_AGO: Record<string, number> = {
  "mock-brainstorm-large": 0,
  "mock-brainstorm-board": 1,
  "mock-brainstorm-pricing": 1, // same day as the board, so that day's heading reads "2 brainstorms"
  "mock-brainstorm-onboarding": 30,
};

/** Mock brainstorms at least this old are stamped in epoch seconds (legacy format). */
const LEGACY_SECONDS_DAYS_AGO = 30;

/** A node inside a board mock is as old as its board. */
function mockDaysAgoOf(id: string): number {
  if (mockLargeTree().nodes.some((n) => n.ref_id === id)) return MOCK_DAYS_AGO[MOCK_LARGE_ROOT];
  if (mockBoardTree().nodes.some((n) => n.ref_id === id)) return MOCK_DAYS_AGO[MOCK_BOARD_ROOT];
  return 2;
}

function mockChoiceTreeUndated(focus: string, labels: string[]): ChoiceTreeData {
  // Any node of a board mock opens its own subtree (the board's "Start here").
  for (const build of [mockLargeTree, mockBoardTree]) {
    const tree = build(labels);
    if (tree.nodes.some((n) => n.ref_id === focus)) return subtreeOf(tree, focus);
  }
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
  return {
    nodes: withMockEffects(nodes, {
      [kid("1a")]: [
        fx("fx-1a-1", "pro", "Simple to build", "Small change, easy to review.", 0.8),
        fx("fx-1a-2", "con", "Limited reach", "Only covers the common case.", 0.3),
      ],
      [kid("2a")]: [fx("fx-2a-1", "pro", "Fast", "Ships this week.", 0.5)],
    }),
    edges,
    truncated: false,
  };
}

/** The root of the brainstorm board mock (`mockBoardTree`). */
export const MOCK_BOARD_ROOT = "mock-brainstorm-board";
/** The root of the large, production-shaped board mock (`mockLargeTree`); the first of `mockBrainstormList`. */
export const MOCK_LARGE_ROOT = "mock-brainstorm-large";

/** `data` cut down to `focus` and its descendants. */
function subtreeOf(data: ChoiceTreeData, focus: string): ChoiceTreeData {
  const keep = new Set([focus]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of data.edges) if (keep.has(e.source) && !keep.has(e.target)) keep.add(e.target), (grew = true);
  }
  return { ...data, nodes: data.nodes.filter((n) => keep.has(n.ref_id)), edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

/** Four brainstorm roots, newest first; the first is the large board mock. */
export function mockBrainstormList(): BrainstormRoot[] {
  return [
    { ref_id: MOCK_LARGE_ROOT, text: "ASSUMED GOAL: catch changes that weaken security before they merge, without slowing every PR down", job: "job-mock-large", made_by: "user" },
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
  return { nodes: withMockEffects(nodes), edges, truncated: false };
}

/**
 * A production-shaped brainstorm: a long root question, five sub-questions
 * with 3-4 long options each (mixed person / agent, one chosen per decided
 * sub-question), two options with follow-up questions of three options, one
 * follow-up a level deeper, and a couple of simulated options. People are
 * `Alice Dev` and `Bob Dev` (seeded mock-org members, matched by name); plain `user`
 * matches nobody. `mock-bl-q2-b` is an open option.
 */
export function mockLargeTree(labels: string[] = ["Question", "Option", "Choice"]): ChoiceTreeData {
  const R = MOCK_LARGE_ROOT;
  let questionId = 0;
  let optionId = 0;
  const nodes: ChoiceTreeData["nodes"] = [];
  const edges: ChoiceTreeData["edges"] = [];
  const q = (id: string, parent: string | null, text: string, props: Record<string, unknown> = {}) => {
    nodes.push({ ref_id: id, type: "Question", properties: { question_id: ++questionId, made_by: "model", state: "open", text, ...props } });
    if (parent) edges.push({ source: parent, target: id });
  };
  const o = (id: string, parent: string, text: string, madeBy: string, state = "open", props: Record<string, unknown> = {}) => {
    nodes.push({ ref_id: id, type: "Option", properties: { option_id: ++optionId, kind: "option", made_by: madeBy, state, text, ...props } });
    edges.push({ source: parent, target: id });
  };
  q(R, null, "ASSUMED GOAL: catch changes that weaken security before they merge, without slowing every PR down", {
    made_by: "Bob Dev",
    state: "decided",
    quote: "Last quarter two PRs loosened auth checks and nobody noticed until the audit. I want a guard that speaks up early, but reviewers already wait too long.",
    criteria: "Fewer weakening changes reach main; median PR time does not grow",
    reversibility: "two_way",
    job: "job-mock-large",
  });

  q("mock-bl-q1", R, "What counts as a change that weakens security?", { state: "decided", criteria: "Concrete enough to automate", reversibility: "two_way" });
  o("mock-bl-q1-a", "mock-bl-q1", "Any edit to authentication or session code, however small, so a human always looks at it", "model");
  o("mock-bl-q1-b", "mock-bl-q1", "A diff that removes or loosens a permission check, a validation, or an authorization guard", "Bob Dev", "chosen");
  o("mock-bl-q1-c", "mock-bl-q1", "New dependencies, or version bumps, that carry a known vulnerability in the advisory feed", "user");
  o("mock-bl-q1-d", "mock-bl-q1", "Secrets, tokens or private keys appearing anywhere in the diff or in the commit history", "model");

  q("mock-bl-q2", R, "Where in the pull request flow should the check run?", { criteria: "Feedback before a reviewer spends time", reversibility: "two_way" });
  o("mock-bl-q2-a", "mock-bl-q2", "As a required CI job on every push, with the result posted as a single summary comment", "model");
  o("mock-bl-q2-b", "mock-bl-q2", "As an advisory bot that comments only when the diff touches code paths tagged as sensitive", "Alice Dev");
  o("mock-bl-q2-c", "mock-bl-q2", "A local pre-push hook developers install, plus a lighter server-side re-check at merge time", "user");
  q("mock-bl-q2-c-q", "mock-bl-q2-c", "How do we keep the check from blocking urgent hotfixes?", { criteria: "Hotfixes ship in minutes, not hours", reversibility: "two_way" });
  o("mock-bl-q2-c-q-a", "mock-bl-q2-c-q", "An on-call engineer can override the block with a written reason that is logged and reviewed later", "model");
  o("mock-bl-q2-c-q-b", "mock-bl-q2-c-q", "Hotfix branches get the full check but only after merge, with an automatic revert if it fails", "Bob Dev");
  q("mock-bl-q2-c-q-b-q", "mock-bl-q2-c-q-b", "Who owns the automatic revert when the late check fails?", { criteria: "A named owner, never nobody", reversibility: "one_way" });
  o("mock-bl-q2-c-q-b-q-a", "mock-bl-q2-c-q-b-q", "The author of the hotfix, notified in the incident channel", "model");
  o("mock-bl-q2-c-q-b-q-b", "mock-bl-q2-c-q-b-q", "Whoever is on the security rota that week, with a four hour response target", "user");
  o("mock-bl-q2-c-q-b-q-c", "mock-bl-q2-c-q-b-q", "A bot reverts at once and the author reopens the change with a fix", "model", "simulated");
  o("mock-bl-q2-c-q-c", "mock-bl-q2-c-q", "Skip the check for changes labelled hotfix by a maintainer, and audit the label usage monthly", "user");

  q("mock-bl-q3", R, "Who reviews what the check flags?", { state: "decided", criteria: "Flags get a human answer within a day", reversibility: "two_way" });
  o("mock-bl-q3-a", "mock-bl-q3", "The code owner of the touched files, since they know the context best", "model", "chosen");
  o("mock-bl-q3-b", "mock-bl-q3", "A small rotating security champion group, one person per team", "Bob Dev");
  o("mock-bl-q3-c", "mock-bl-q3", "A dedicated security engineer who triages everything, before it reaches the team", "user");

  q("mock-bl-q4", R, "How should the check learn what is risky in our codebase?", { criteria: "Few false alarms after the first month", reversibility: "two_way" });
  o("mock-bl-q4-a", "mock-bl-q4", "A hand-written list of rules maintained by the security team, reviewed every quarter", "user");
  o("mock-bl-q4-b", "mock-bl-q4", "Ask a language model to read each diff and judge whether it weakens a security property", "model");
  q("mock-bl-q4-b-q", "mock-bl-q4-b", "How do we trust the model's verdict on a diff?", { criteria: "Verdicts are explainable and testable", reversibility: "two_way" });
  o("mock-bl-q4-b-q-a", "mock-bl-q4-b-q", "Require it to quote the exact lines and name the property it believes is weakened", "Bob Dev");
  o("mock-bl-q4-b-q-b", "mock-bl-q4-b-q", "Replay a fixed set of past incidents against it before every model or prompt change", "model");
  o("mock-bl-q4-b-q-c", "mock-bl-q4-b-q", "Let a human mark each verdict right or wrong and track the score over time", "Alice Dev");
  o("mock-bl-q4-c", "mock-bl-q4", "Mine our own history: every past security fix becomes a pattern that the check looks for", "model");
  o("mock-bl-q4-d", "mock-bl-q4", "A learning system that watches review comments and proposes new rules on its own", "user", "simulated");

  q("mock-bl-q5", R, "How do we know it works without slowing PRs down?", { state: "decided", criteria: "A number we can read each week", reversibility: "two_way" });
  o("mock-bl-q5-a", "mock-bl-q5", "Track the median time from open to merge, before and after, for PRs the check touched", "user");
  o("mock-bl-q5-b", "mock-bl-q5", "Count weakening changes found by later audits that the check had let through", "model");
  o("mock-bl-q5-c", "mock-bl-q5", "Both numbers on one weekly dashboard, with a budget of two extra minutes per PR", "Bob Dev", "chosen");

  const kept = withMockEffects(nodes).filter((n) => labels.includes(n.type));
  const ids = new Set(kept.map((n) => n.ref_id));
  return { nodes: kept, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)), truncated: false };
}
