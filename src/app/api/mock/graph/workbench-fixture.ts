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
