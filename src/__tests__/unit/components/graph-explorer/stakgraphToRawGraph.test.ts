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
    const rows = [[{ ref_id: "1", name: "AuthService", node_type: "Class" }]];
    const { nodes, edges } = stakgraphToRawGraph(["n"], rows);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "1", label: "AuthService" });
    expect(edges).toHaveLength(0);
  });

  test("label falls back to node_type when name is absent", () => {
    const rows = [[{ ref_id: "42", node_type: "Module" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].label).toBe("Module");
  });

  test("label falls back to ref_id when neither name nor node_type is present", () => {
    const rows = [[{ ref_id: "99" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].label).toBe("99");
  });

  test("deduplicates nodes appearing in multiple rows", () => {
    const rows = [
      [{ ref_id: "1", name: "A", node_type: "File" }],
      [{ ref_id: "1", name: "A", node_type: "File" }],
    ];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes).toHaveLength(1);
  });

  // ── nodes + relationships ────────────────────────────────────────────────

  test("two-node row with relationship object produces one edge", () => {
    const rows = [
      [
        { ref_id: "1", name: "processData", node_type: "Function" },
        { type: "CALLS" },
        { ref_id: "2", name: "validateInput", node_type: "Function" },
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
        { ref_id: "1", name: "A", node_type: "File" },
        { ref_id: "2", name: "B", node_type: "File" },
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
        { ref_id: "1", name: "AuthService", node_type: "File" },
        { type: "IMPORTS" },
        { ref_id: "2", name: "db.ts", node_type: "File" },
      ],
      [
        { ref_id: "1", name: "AuthService", node_type: "File" },
        { type: "IMPORTS" },
        { ref_id: "3", name: "encryption.ts", node_type: "File" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r", "m"], rows);

    expect(nodes).toHaveLength(3); // deduped: 1, 2, 3
    expect(edges).toHaveLength(2);
  });

  test("three-node row with two relationship objects produces two edges", () => {
    // [node1, rel1, node2, rel2, node3] → consecutive-pairs: 1→2 (REL1), 2→3 (REL2)
    const rows = [
      [
        { ref_id: "1", name: "A", node_type: "Node" },
        { type: "REL1" },
        { ref_id: "2", name: "B", node_type: "Node" },
        { type: "REL2" },
        { ref_id: "3", name: "C", node_type: "Node" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r1", "m", "r2", "p"], rows);

    expect(nodes).toHaveLength(3); // 1, 2, and 3 all registered
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ source: "1", target: "2", label: "REL1" });
    expect(edges[1]).toMatchObject({ source: "2", target: "3", label: "REL2" });
  });

  test("columns param is ignored (only rows are used)", () => {
    const rows = [[{ ref_id: "1", name: "X", node_type: "File" }]];
    const result1 = stakgraphToRawGraph([], rows);
    const result2 = stakgraphToRawGraph(["a", "b", "c"], rows);
    expect(result1.nodes).toEqual(result2.nodes);
    expect(result1.edges).toEqual(result2.edges);
  });

  test("link and icon fields are forwarded when present", () => {
    const rows = [[{ ref_id: "1", name: "Fn", node_type: "Function", link: "https://example.com", icon: "★" }]];
    const { nodes } = stakgraphToRawGraph(["n"], rows);
    expect(nodes[0].link).toBe("https://example.com");
    expect(nodes[0].icon).toBe("★");
  });

  // ── backward compatibility ────────────────────────────────────────────────

  test("legacy id-based nodes are still parsed for backward compatibility", () => {
    const rows = [
      [
        { id: "1", name: "LegacyNode", type: "File" },
        { type: "IMPORTS" },
        { id: "2", name: "OtherNode", type: "File" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r", "m"], rows);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "1", target: "2", label: "IMPORTS" });
  });

  // ── regression ───────────────────────────────────────────────────────────

  test("real-shaped nodes (ref_id, no id) are correctly parsed with relationship label", () => {
    const rows = [
      [
        { ref_id: "abc-123", name: "validateInput", node_type: "Function" },
        { type: "CALLS" },
        { ref_id: "def-456", name: "processData", node_type: "Function" },
      ],
    ];
    const { nodes, edges } = stakgraphToRawGraph(["n", "r", "m"], rows);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "abc-123", target: "def-456", label: "CALLS" });
  });
});
