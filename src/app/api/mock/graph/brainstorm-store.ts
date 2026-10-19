/**
 * Mock mode (`USE_MOCKS`): brainstorm saves land here instead of Jarvis, and
 * the brainstorm reads (`getChoiceTree`, `listBrainstormRoots`) overlay them
 * on the fixtures, so a save on the desk reads back. In memory only, kept on
 * `globalThis` so a dev-server reload doesn't drop it.
 */

import type { SavePlan } from "@/services/graph/brainstorm-write";
import type { BrainstormRoot, ChoiceTreeData, ChoiceTreeNode } from "@/services/graph/workbench";
import { mockBrainstormList, mockChoiceTree } from "./workbench-fixture";

interface Store {
  /** Cards created by saves. */
  nodes: Map<string, ChoiceTreeNode>;
  edges: Array<{ source: string; target: string }>;
  /** Saved changes to fixture cards, by ref_id. */
  patches: Map<string, Record<string, unknown>>;
  /** New brainstorms, newest first. */
  roots: string[];
  seq: number;
}

const holder = globalThis as unknown as { __mockBrainstormStore?: Store };
const store = (): Store =>
  (holder.__mockBrainstormStore ??= { nodes: new Map(), edges: [], patches: new Map(), roots: [], seq: 0 });

export function resetMockBrainstormStore() {
  delete holder.__mockBrainstormStore;
}

const isDeleted = (p: Record<string, unknown>) => p.deleted_at != null || p.is_deleted === true;

/** Applies a save plan; returns each new card's ref_id by the client's temp id. */
export function mockBrainstormWrite(plan: SavePlan): Record<string, string> {
  const s = store();
  const created: Record<string, string> = {};
  const ref = (e: { ref: string } | { temp: string }) => ("ref" in e ? e.ref : created[e.temp]);
  for (const c of plan.creates) {
    const id = `mock-bs-${++s.seq}`;
    created[c.temp] = id;
    s.nodes.set(id, { ref_id: id, type: c.nodeType, properties: { ...c.data } });
    if (c.parent) s.edges.push({ source: ref(c.parent), target: id });
    else s.roots.unshift(id);
  }
  for (const [id, data] of Object.entries(plan.patches)) {
    const own = s.nodes.get(id);
    if (own) Object.assign(own.properties, data);
    else s.patches.set(id, { ...s.patches.get(id), ...data });
  }
  // Links (ABOUT / BUILDS_ON) aren't read by the tree, so the mock keeps none.
  return created;
}

/** The fixture tree under `focus` with every save applied: new cards in, removed cards out. */
export function mockChoiceTreeWithWrites(focus: string, labels: string[]): ChoiceTreeData {
  const s = store();
  const base = s.nodes.has(focus) ? { nodes: [], edges: [] } : mockChoiceTree(focus, labels);
  const nodes = new Map<string, ChoiceTreeNode>(
    base.nodes.map((n) => [n.ref_id, { ...n, properties: { ...n.properties, ...s.patches.get(n.ref_id) } }]),
  );
  for (const [id, n] of s.nodes) nodes.set(id, { ...n, properties: { ...n.properties } });
  const edges = [...base.edges, ...s.edges];
  const keep = new Set<string>();
  for (const stack = [focus]; stack.length; ) {
    const id = stack.pop()!;
    const n = nodes.get(id);
    if (!n || keep.has(id) || isDeleted(n.properties) || !labels.includes(n.type)) continue;
    keep.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return {
    nodes: [...nodes.values()].filter((n) => keep.has(n.ref_id)),
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    truncated: false,
  };
}

/** The fixture brainstorm list with saved new brainstorms first. */
export function mockBrainstormListWithWrites(): BrainstormRoot[] {
  const s = store();
  const added = s.roots
    .map((id) => s.nodes.get(id)!)
    .filter((n) => !isDeleted(n.properties))
    .map((n) => ({
      ref_id: n.ref_id,
      text: typeof n.properties.text === "string" ? n.properties.text : n.ref_id,
      job: null,
      made_by: "user",
    }));
  return [...added, ...mockBrainstormList()];
}
