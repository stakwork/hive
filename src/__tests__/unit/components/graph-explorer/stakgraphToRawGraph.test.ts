import { describe, expect, test } from "vitest";
import { stakgraphToRawGraph } from "@/components/graph-explorer/stakgraphToRawGraph";

describe("stakgraphToRawGraph", () => {
  // ── empty ────────────────────────────────────────────────────────────────

  test("empty rows → empty nodes and edges", () => {
    const { nodes, edges } = stakgraphToRawGraph([], []);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  test("rows with no node-like objects are skipped", () => {
    const { nodes, edges } = stakgraphToRawGraph(["n"], [["not-an-object"], [42], [null]]);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  // ── nodes only ───────────────────────────────────────────────────────────

  test("single-node row produces one node and no edges", () => {
    const rows = [[{ id: "1", name: "AuthService", type: "Class" }]];
    const { nodes, edges } = stakgraphToRawGraph(["n"], rows);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "1", label: "AuthService" });
    expect(edges).toHaveLength(0);
  });

  test("label falls back to type when name is absent", () => {
    const rows = [[{ id: "42", type: "Module" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].label).toBe("Module");
  });

  test("label falls back to id when neither name nor type is present", () => {
    const rows = [[{ id: "99" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].label).toBe("99");
  });

  test("deduplicates nodes appearing in multiple rows", () => {
    const rows = [
      [{ id: "1", name: "A", type: "File" }],
      [{ id: "1", name: "A", type: "File" }],
    ];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes).toHaveLength(1);
  });

  // ── nodes + relationships ────────────────────────────────────────────────

  test("two-node row with relationship object produces one edge", () => {
    const rows = [
      [
        { id: "1", name: "processData", type: "Function" },
        { id: "20", type: "CALLS" },
        { id: "2", name: "validateInput", type: "Function" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r", "m"], rows);

    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "1",
      target: "2",
      label: "CALLS",
    });
  });

  test("two-node row without middle object produces a generic edge (no label)", () => {
    const rows = [
      [
        { id: "1", name: "A", type: "File" },
        { id: "2", name: "B", type: "File" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "m"], rows);

    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("1");
    expect(edges[0].target).toBe("2");
    expect(edges[0].label).toBeUndefined();
  });

  test("multiple rows accumulate nodes and edges", () => {
    const rows = [
      [
        { id: "1", name: "AuthService", type: "File" },
        { id: "10", type: "IMPORTS" },
        { id: "2", name: "db.ts", type: "File" },
      ],
      [
        { id: "1", name: "AuthService", type: "File" },
        { id: "11", type: "IMPORTS" },
        { id: "3", name: "encryption.ts", type: "File" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r", "m"], rows);

    expect(nodes).toHaveLength(3); // deduped: 1, 2, 3
    expect(edges).toHaveLength(2);
  });

  test("three-node row with two relationship objects produces two edges", () => {
    // n-r1-m-r2-p pattern: source=n, target=p, middle=[r1, m, r2]
    // middle objects that are node-like are treated as relationship objects too
    const rows = [
      [
        { id: "1", name: "A", type: "Node" },
        { id: "20", type: "REL1" },
        { id: "2", name: "B", type: "Node" },
        { id: "21", type: "REL2" },
        { id: "3", name: "C", type: "Node" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r1", "m", "r2", "p"], rows);

    // source=1, target=3, middle=[{id:20, type:REL1}, {id:2,...}, {id:21, type:REL2}]
    // Each middle object → edge from src→tgt
    expect(nodes).toHaveLength(2); // only 1 and 3 registered (first + last)
    expect(edges).toHaveLength(3); // 3 middle objects → 3 edges
    edges.forEach((e) => {
      expect(e.source).toBe("1");
      expect(e.target).toBe("3");
    });
  });

  test("columns param is ignored (only rows are used)", () => {
    const rows = [[{ id: "1", name: "X", type: "File" }]];
    const result1 = stakgraphToRawGraph([], rows);
    const result2 = stakgraphToRawGraph(["a", "b", "c"], rows);
    expect(result1.nodes).toEqual(result2.nodes);
    expect(result1.edges).toEqual(result2.edges);
  });

  test("link and icon fields are forwarded when present", () => {
    const rows = [[{ id: "1", name: "Fn", type: "Function", link: "https://example.com", icon: "★" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].link).toBe("https://example.com");
    expect(nodes[0].icon).toBe("★");
  });
});
