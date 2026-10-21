/**
 * Mock mode (`USE_MOCKS`): one planned initiative for `getInitiativeTree`,
 * whatever ref_id is asked for — two milestones, a brief, three features and
 * their stories and requirements, some still proposed. Saves from the canvas
 * (`saveInitiativeChanges`) land in an in-memory store overlaid on it, kept on
 * `globalThis` so a dev-server reload doesn't drop it.
 */

import type { InitiativePlan } from "@/services/graph/initiative-write";
import type { InitiativeNodeType, InitiativeTreeData, InitiativeTreeNode } from "@/services/graph/workbench";

type Tree = Pick<InitiativeTreeData, "nodes" | "edges">;

interface Store {
  nodes: Map<string, InitiativeTreeNode>;
  edges: InitiativeTreeData["edges"];
  patches: Map<string, Record<string, unknown>>;
  /** Initiatives created by saves. */
  roots: Set<string>;
  seq: number;
}

const holder = globalThis as unknown as { __mockInitiativeStore?: Store };
const store = (): Store =>
  (holder.__mockInitiativeStore ??= { nodes: new Map(), edges: [], patches: new Map(), roots: new Set(), seq: 0 });

export function resetMockInitiativeStore() {
  delete holder.__mockInitiativeStore;
}

/** Applies a save plan to the store; returns the ref_id each new card got. */
export function mockInitiativeWrite(root: string | null, plan: InitiativePlan): Record<string, string> {
  const s = store();
  const created: Record<string, string> = {};
  for (const c of plan.creates) {
    const id = `mock-plan-${++s.seq}`;
    created[c.temp] = id;
    s.nodes.set(id, { ref_id: id, type: c.nodeType, properties: { ...c.data } });
    if (c.nodeType === "HiveInitiative" && root === null) s.roots.add(id);
    if (c.parent && c.edgeType) {
      const source = "ref" in c.parent ? c.parent.ref : created[c.parent.temp];
      s.edges.push({ source, target: id, type: c.edgeType });
    }
  }
  for (const [id, data] of Object.entries(plan.patches)) {
    const own = s.nodes.get(id);
    if (own) own.properties = { ...own.properties, ...data };
    else s.patches.set(id, { ...s.patches.get(id), ...data });
  }
  return created;
}

/** The fixture (or a saved initiative) with the store's saves overlaid, reachable from `refId`. */
export function mockInitiativeTree(refId: string): Tree {
  const s = store();
  const base = s.roots.has(refId) ? { nodes: [], edges: [] } : fixtureTree(refId);
  const nodes = new Map<string, InitiativeTreeNode>(
    base.nodes.map((n) => [n.ref_id, { ...n, properties: { ...n.properties, ...s.patches.get(n.ref_id) } }]),
  );
  for (const [id, n] of s.nodes) nodes.set(id, { ...n, properties: { ...n.properties } });
  const edges = [...base.edges, ...s.edges];
  const keep = new Set<string>();
  for (const stack = [refId]; stack.length; ) {
    const id = stack.pop()!;
    if (keep.has(id) || !nodes.has(id)) continue;
    keep.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return {
    nodes: [...nodes.values()].filter((n) => keep.has(n.ref_id)),
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

function fixtureTree(refId: string): Tree {
  const nodes: InitiativeTreeNode[] = [];
  const edges: InitiativeTreeData["edges"] = [];
  const add = (
    type: InitiativeNodeType,
    id: string,
    properties: Record<string, unknown>,
    parent?: string,
    edge?: string,
  ) => {
    nodes.push({ ref_id: id, type, properties: { created_by_kind: "human", ...properties } });
    if (parent && edge) edges.push({ source: parent, target: id, type: edge });
  };

  add("HiveInitiative", refId, { initiative_id: refId, name: "Self-serve onboarding", status: "ACTIVE" });
  add(
    "Brief",
    `${refId}-brief`,
    {
      brief_id: `${refId}-brief`,
      text: "New orgs stall before their first workspace; get them to a first task alone.",
    },
    refId,
    "HAS_BRIEF",
  );
  const milestones = [
    { id: `${refId}-m1`, name: "Sign-up to first workspace", sequence: 1 },
    { id: `${refId}-m2`, name: "First task without help", sequence: 2 },
  ];
  for (const m of milestones) {
    add(
      "HiveMilestone",
      m.id,
      { milestone_id: m.id, name: m.name, sequence: m.sequence, status: "NOT_STARTED" },
      refId,
      "HAS_MILESTONE",
    );
  }
  const features = [
    { m: milestones[0].id, name: "Guided workspace setup", reqs: ["accepted", "accepted", "proposed"] },
    { m: milestones[0].id, name: "Repo picker", reqs: ["accepted"] },
    { m: milestones[1].id, name: "Starter task templates", reqs: ["proposed", "proposed", "dropped"] },
  ];
  features.forEach((f, i) => {
    const fid = `${refId}-f${i + 1}`;
    add(
      "InitiativeFeature",
      fid,
      { feature_id: fid, name: f.name, status: "proposed", created_by_kind: "strut" },
      f.m,
      "HAS_FEATURE",
    );
    const sid = `${fid}-s1`;
    add(
      "UserStory",
      sid,
      { story_id: sid, text: `As a new admin I can finish "${f.name}" on my own.`, status: "proposed" },
      fid,
      "HAS_STORY",
    );
    f.reqs.forEach((status, j) => {
      const rid = `${sid}-r${j + 1}`;
      add(
        "Requirement",
        rid,
        { requirement_id: rid, text: `${f.name}: requirement ${j + 1}`, status },
        sid,
        "HAS_REQUIREMENT",
      );
    });
  });
  return { nodes, edges };
}
