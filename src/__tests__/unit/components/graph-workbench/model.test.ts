import { describe, test, expect } from "vitest";
import {
  DEFAULT_TREE,
  buildGraph,
  childrenOf,
  health,
  parentsOf,
  pathsToRoot,
  rootsOf,
} from "@/components/graph-workbench/model";
import type { Hierarchy } from "@/services/graph/workbench";

const node = (id: string, extra: Partial<Hierarchy["nodes"][number]> = {}) => ({
  id,
  key: null,
  name: id,
  description: null,
  docs: `# ${id}\n\nEnough words for an agent to learn from.`,
  repo: null,
  reads: 1,
  approvers: [],
  ...extra,
});

/**
 *   glimmer ─┬─ coding ─┬─ security
 *            │          └─ verify-code ── audit
 *            └─ verify ──── verify-code          (verify-code has two parents)
 *   medicine ── obstetrics
 *   loose                                         (no parent, no children)
 */
const hierarchy: Hierarchy = {
  nodes: [
    node("glimmer"),
    node("coding"),
    node("security"),
    node("verify"),
    node("verify-code"),
    node("audit", { docs: "" }),
    node("medicine"),
    node("obstetrics"),
    node("loose", { reads: 0, repo: "stakwork/hive" }),
  ],
  edges: [
    { type: "PARENT_OF", source: "glimmer", target: "coding" },
    { type: "PARENT_OF", source: "glimmer", target: "verify" },
    { type: "PARENT_OF", source: "coding", target: "security" },
    { type: "PARENT_OF", source: "coding", target: "verify-code" },
    { type: "PARENT_OF", source: "verify", target: "verify-code" },
    { type: "PARENT_OF", source: "verify-code", target: "audit" },
    { type: "PARENT_OF", source: "medicine", target: "obstetrics" },
    { type: "RELATED_TO", source: "audit", target: "security" },
    { type: "PARENT_OF", source: "coding", target: "not-loaded" },
    { type: "PARENT_OF", source: "coding", target: "coding" },
  ],
  truncated: false,
};

const graph = buildGraph(hierarchy, DEFAULT_TREE);

describe("buildGraph", () => {
  test("infers roots: children and no parent", () => {
    const roots = Object.values(graph.nodes)
      .filter((n) => n.root)
      .map((n) => n.id);
    expect(roots.sort()).toEqual(["glimmer", "medicine"]);
  });

  test("indexes parents and children, ignoring self-loops and edges to nodes it didn't load", () => {
    expect(childrenOf(graph, "coding")).toEqual(["security", "verify-code"]);
    expect(parentsOf(graph, "verify-code")).toEqual(["coding", "verify"]);
    expect(parentsOf(graph, "coding")).toEqual(["glimmer"]);
  });

  test("counts the edges a tree could follow, most used first", () => {
    expect(graph.edgeTypes).toEqual([
      { type: "PARENT_OF", count: 7 },
      { type: "RELATED_TO", count: 1 },
    ]);
  });

  test("builds the tree along whichever edge the lens names", () => {
    const along = buildGraph(hierarchy, { type: "Concept", edge: "RELATED_TO" });
    expect(childrenOf(along, "audit")).toEqual(["security"]);
    expect(childrenOf(along, "coding")).toEqual([]);
    expect(
      Object.values(along.nodes)
        .filter((n) => n.root)
        .map((n) => n.id),
    ).toEqual(["audit"]);
  });
});

describe("buildGraph's edge", () => {
  test("keeps the lens's edge when the type uses it", () => {
    expect(buildGraph(hierarchy, { type: "Concept", edge: "RELATED_TO" }).lens.edge).toBe("RELATED_TO");
  });

  test("falls back to PARENT_OF when the type uses it", () => {
    expect(buildGraph(hierarchy, { type: "Concept", edge: "CONTAINS" }).lens.edge).toBe("PARENT_OF");
  });

  test("otherwise takes the type's most common edge", () => {
    const tables: Hierarchy = {
      nodes: [node("db"), node("users"), node("posts")],
      edges: [
        { type: "CONTAINS", source: "db", target: "users" },
        { type: "CONTAINS", source: "db", target: "posts" },
        { type: "REFERENCES", source: "posts", target: "users" },
      ],
      truncated: false,
    };
    const along = buildGraph(tables, DEFAULT_TREE);
    expect(along.lens).toEqual({ type: "Concept", edge: "CONTAINS" });
    expect(childrenOf(along, "db")).toEqual(["posts", "users"]);
  });
});

describe("pathsToRoot", () => {
  test("returns every path when a node has several parents", () => {
    expect(pathsToRoot(graph, "audit")).toEqual([
      ["glimmer", "coding", "verify-code", "audit"],
      ["glimmer", "verify", "verify-code", "audit"],
    ]);
  });

  test("terminates on a cycle", () => {
    const cyclic = buildGraph(
      {
        nodes: [node("a"), node("b")],
        edges: [
          { type: "PARENT_OF", source: "a", target: "b" },
          { type: "PARENT_OF", source: "b", target: "a" },
        ],
        truncated: false,
      },
      DEFAULT_TREE,
    );
    expect(() => pathsToRoot(cyclic, "a")).not.toThrow();
  });
});

describe("rootsOf", () => {
  test("puts the biggest tree first", () => {
    expect(rootsOf(graph).map((r) => [r.node.id, r.size])).toEqual([
      ["glimmer", 5],
      ["medicine", 1],
    ]);
  });
});

describe("health", () => {
  test("finds nodes outside any tree, several parents, empty docs and nothing read", () => {
    const byKey = Object.fromEntries(health(graph).map((g) => [g.key, g.ids]));
    expect(byKey).toEqual({
      unplaced: ["loose"],
      multiParent: ["verify-code"],
      emptyDocs: ["audit"],
      unread: ["loose"],
    });
  });
});
