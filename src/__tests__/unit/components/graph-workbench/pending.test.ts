import { describe, test, expect } from "vitest";
import { DEFAULT_TREE, buildGraph, childrenOf, parentsOf } from "@/components/graph-workbench/model";
import { NO_PENDING, applyChanges, findNode } from "@/components/graph-workbench/pending";
import type { Hierarchy } from "@/services/graph/workbench";

const node = (id: string, key: string | null = null) => ({
  id,
  key,
  name: id[0].toUpperCase() + id.slice(1),
  description: null,
  docs: `# ${id}\n\nEnough words for an agent to learn from.`,
  repo: null,
  reads: 1,
  approvers: [],
});

/** glimmer ── coding ── security;  loose (no tree) */
const hierarchy: Hierarchy = {
  nodes: [node("glimmer", "stakwork/hive/glimmer"), node("coding"), node("security"), node("loose")],
  edges: [
    { type: "PARENT_OF", source: "glimmer", target: "coding" },
    { type: "PARENT_OF", source: "coding", target: "security" },
  ],
  truncated: false,
};

const base = () => buildGraph(hierarchy, DEFAULT_TREE);

describe("findNode", () => {
  test("finds a node by ref_id, its own id, or its name in any case", () => {
    const g = base();
    expect(findNode(g, "coding")).toBe("coding");
    expect(findNode(g, "stakwork/hive/glimmer")).toBe("glimmer");
    expect(findNode(g, "SECURITY")).toBe("security");
    expect(findNode(g, "nowhere")).toBeNull();
  });
});

describe("applyChanges", () => {
  test("leaves the graph alone when there are no changes", () => {
    const g = base();
    expect(applyChanges(g, undefined)).toEqual({ graph: g, pending: NO_PENDING });
  });

  test("draws a new node under its parent, and leaves the loaded graph as it was", () => {
    const g = base();
    const { graph, pending } = applyChanges(g, [
      { kind: "node", name: "SSRF Check", parent: "Security", docs: "# SSRF" },
    ]);

    const id = childrenOf(graph, "security")[0];
    expect(graph.nodes[id]).toMatchObject({ name: "SSRF Check", proposed: "new", docs: "# SSRF" });
    expect(pending).toMatchObject({ created: 1, edited: 0, focus: "security" });
    expect(pending.newEdges).toEqual(new Set([`security>${id}`]));
    expect(pending.touched).toEqual(new Set(["security", id]));
    expect(childrenOf(g, "security")).toEqual([]);
    expect(g.nodes[id]).toBeUndefined();
  });

  test("marks a docs change on the node it addresses", () => {
    const { graph, pending } = applyChanges(base(), [
      { kind: "docs", node: "stakwork/hive/glimmer", before: "# old", after: "# new" },
    ]);

    expect(graph.nodes.glimmer).toMatchObject({
      proposed: "changed",
      edit: { kind: "docs", before: "# old", after: "# new" },
    });
    expect(pending).toMatchObject({ created: 0, edited: 1, focus: "glimmer" });
  });

  test("draws an edge of another type as a link, and an end it can't find as a new node", () => {
    const { graph, pending } = applyChanges(base(), [
      { kind: "edge", edge: "DEPENDS_ON", source: "coding", target: "Secrets Handling" },
    ]);

    const added = Object.values(graph.nodes).find((n) => n.proposed === "new");
    expect(added?.name).toBe("Secrets Handling");
    expect(pending.links).toEqual([{ edge: "DEPENDS_ON", source: "coding", target: added?.id }]);
    expect(pending.newEdges.size).toBe(0);
    expect(pending.created).toBe(1);
  });

  test("re-infers roots around a new tree edge", () => {
    const { graph } = applyChanges(base(), [{ kind: "edge", edge: "PARENT_OF", source: "loose", target: "glimmer" }]);

    expect(parentsOf(graph, "glimmer")).toEqual(["loose"]);
    expect(graph.nodes.glimmer.root).toBe(false);
    expect(graph.nodes.loose.root).toBe(true);
  });
});
