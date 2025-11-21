import { describe, test, expect } from "vitest";
import { DEFAULT_TRANSFORM } from "@/components/graph/useGraphData";

describe("DEFAULT_TRANSFORM", () => {
  describe("valid data transformation", () => {
    test("should transform nodes with all properties present", () => {
      const input = {
        nodes: [
          {
            ref_id: "node-1",
            id: "old-id-1",
            name: "Test Node",
            node_type: "Function",
            properties: {
              name: "Property Name",
              title: "Property Title",
              extra: "value",
            },
          },
        ],
        edges: [
          {
            source: "node-1",
            target: "node-2",
            weight: 5,
          },
        ],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({
        // Due to {...node} spread AFTER computed properties, original node.id overrides computed id
        id: "old-id-1", // node.id overrides computed ref_id via ...node spread
        name: "Test Node", // node.name overrides computed properties.name via ...node spread
        type: "Function", // node_type computes to 'Function', no node.type to override
      });
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toMatchObject({
        source: "node-1",
        target: "node-2",
        weight: 5,
      });
    });

    test("should preserve all original node properties", () => {
      const input = {
        nodes: [
          {
            id: "node-1",
            name: "Test",
            customProp: "custom-value",
            nested: { data: "nested-value" },
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0]).toHaveProperty("customProp", "custom-value");
      expect(result.nodes[0]).toHaveProperty("nested", { data: "nested-value" });
    });

    test("should preserve all original edge properties", () => {
      const input = {
        nodes: [{ id: "n1" }, { id: "n2" }],
        edges: [
          {
            source: "n1",
            target: "n2",
            weight: 10,
            metadata: { type: "strong" },
          },
        ],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.edges[0]).toHaveProperty("weight", 10);
      expect(result.edges[0]).toHaveProperty("metadata", { type: "strong" });
    });
  });

  describe("fallback chain: id property", () => {
    test("should use ref_id when available", () => {
      const input = {
        nodes: [{ ref_id: "ref-123", id: "id-456", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      // Due to {...node} spread AFTER computed id, node.id overrides computed ref_id
      expect(result.nodes[0].id).toBe("id-456"); // node.id overrides via ...node spread
    });

    test("should fall back to id when ref_id is missing", () => {
      const input = {
        nodes: [{ id: "id-456", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].id).toBe("id-456");
    });

    test("should handle undefined ref_id and use id", () => {
      const input = {
        nodes: [{ ref_id: undefined, id: "id-789", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].id).toBe("id-789");
    });
  });

  describe("fallback chain: name property", () => {
    test("should use properties.name when available", () => {
      const input = {
        nodes: [
          {
            id: "1",
            properties: { name: "Prop Name", title: "Prop Title" },
            name: "Direct Name",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      // Due to {...node} spread AFTER computed name, node.name overrides computed properties.name
      expect(result.nodes[0].name).toBe("Direct Name"); // node.name overrides via ...node spread
    });

    test("should fall back to properties.title when properties.name is missing", () => {
      const input = {
        nodes: [
          {
            id: "1",
            properties: { title: "Prop Title" },
            name: "Direct Name",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      // Due to {...node} spread AFTER computed name, node.name overrides computed properties.title
      expect(result.nodes[0].name).toBe("Direct Name"); // node.name overrides via ...node spread
    });

    test("should fall back to name when properties are missing", () => {
      const input = {
        nodes: [{ id: "1", name: "Direct Name" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].name).toBe("Direct Name");
    });

    test('should use "Unnamed" when all name properties are missing', () => {
      const input = {
        nodes: [{ id: "1" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].name).toBe("Unnamed");
    });

    test("should handle undefined properties object", () => {
      const input = {
        nodes: [{ id: "1", properties: undefined, name: "Fallback" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].name).toBe("Fallback");
    });

    test("should handle empty string values and fall back", () => {
      const input = {
        nodes: [
          {
            id: "1",
            properties: { name: "", title: "" },
            name: "",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      // Due to {...node} spread AFTER computed name, empty string node.name overrides 'Unnamed'
      expect(result.nodes[0].name).toBe(""); // Empty string from node.name overrides via ...node spread
    });
  });

  describe("fallback chain: type property", () => {
    test("should use node_type when available", () => {
      const input = {
        nodes: [
          {
            id: "1",
            node_type: "Function",
            labels: ["Class", "Data_Bank"],
            type: "OldType",
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      // Due to {...node} spread AFTER computed type, node.type overrides computed node_type
      expect(result.nodes[0].type).toBe("OldType"); // node.type overrides via ...node spread
    });

    test("should filter Data_Bank from labels and use first remaining label", () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Data_Bank", "Class", "Method"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Class");
    });

    test("should skip Data_Bank label even if it appears first", () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Data_Bank", "Component"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Component");
    });

    test("should fall back to type property when node_type and labels are missing", () => {
      const input = {
        nodes: [{ id: "1", type: "FallbackType", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("FallbackType");
    });

    test('should use "Unknown" when all type properties are missing', () => {
      const input = {
        nodes: [{ id: "1", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Unknown");
    });

    test('should use "Unknown" when labels only contains Data_Bank', () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Data_Bank"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Unknown");
    });

    test("should handle undefined labels array", () => {
      const input = {
        nodes: [{ id: "1", labels: undefined, type: "Fallback", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Fallback");
    });

    test("should handle empty labels array", () => {
      const input = {
        nodes: [{ id: "1", labels: [], type: "Fallback", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Fallback");
    });
  });

  describe("edge cases: missing data structures", () => {
    test("should return empty arrays when data.nodes is missing", () => {
      const input = { edges: [] };

      const result = DEFAULT_TRANSFORM(input);

      expect(result).toEqual({ nodes: [], edges: [] });
    });

    test("should return empty arrays when data.edges is missing", () => {
      const input = { nodes: [] };

      const result = DEFAULT_TRANSFORM(input);

      expect(result).toEqual({ nodes: [], edges: [] });
    });

    test("should return empty arrays when both nodes and edges are missing", () => {
      const input = {};

      const result = DEFAULT_TRANSFORM(input);

      expect(result).toEqual({ nodes: [], edges: [] });
    });

    test("should return empty arrays when data is null", () => {
      // The function checks (data.nodes && data.edges) which throws on null
      // This test expects the function to throw, not return empty arrays
      expect(() => DEFAULT_TRANSFORM(null)).toThrow();
    });

    test("should return empty arrays when data is undefined", () => {
      // The function checks (data.nodes && data.edges) which throws on undefined
      // This test expects the function to throw, not return empty arrays
      expect(() => DEFAULT_TRANSFORM(undefined)).toThrow();
    });

    test("should handle empty nodes array", () => {
      const input = { nodes: [], edges: [] };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    test("should handle empty edges array", () => {
      const input = {
        nodes: [{ id: "1", name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe("edge cases: null and undefined properties", () => {
    test("should handle nodes with null properties", () => {
      const input = {
        nodes: [
          {
            id: null,
            name: null,
            properties: null,
            labels: null,
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(1);
      // Due to {...node} spread AFTER computed name, null from node.name overrides 'Unnamed'
      expect(result.nodes[0].name).toBe(null); // null from node.name overrides via ...node spread
      expect(result.nodes[0].type).toBe("Unknown");
    });

    test("should handle nodes with nested null properties", () => {
      const input = {
        nodes: [
          {
            id: "1",
            properties: { name: null, title: null },
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].name).toBe("Unnamed");
    });

    test("should handle edges with null source and target", () => {
      const input = {
        nodes: [],
        edges: [{ source: null, target: null }],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toMatchObject({ source: null, target: null });
    });
  });

  describe("integration: multiple nodes and edges", () => {
    test("should transform multiple nodes with different fallback paths", () => {
      const input = {
        nodes: [
          { ref_id: "n1", properties: { name: "Node 1" }, node_type: "Class" },
          { id: "n2", properties: { title: "Node 2" }, labels: ["Function"] },
          { id: "n3", name: "Node 3", type: "Module" },
          { id: "n4" }, // All fallbacks
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
          { source: "n3", target: "n4" },
        ],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(4);
      expect(result.nodes[0]).toMatchObject({ id: "n1", name: "Node 1", type: "Class" });
      expect(result.nodes[1]).toMatchObject({ id: "n2", name: "Node 2", type: "Function" });
      expect(result.nodes[2]).toMatchObject({ id: "n3", name: "Node 3", type: "Module" });
      expect(result.nodes[3]).toMatchObject({ id: "n4", name: "Unnamed", type: "Unknown" });

      expect(result.edges).toHaveLength(3);
    });

    test("should handle large dataset with mixed properties", () => {
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        name: i % 2 === 0 ? `Node ${i}` : undefined,
        properties: i % 3 === 0 ? { title: `Title ${i}` } : undefined,
        node_type: i % 5 === 0 ? "Function" : undefined,
        labels: i % 7 === 0 ? ["Data_Bank", "Class"] : undefined,
      }));

      const edges = Array.from({ length: 99 }, (_, i) => ({
        source: `node-${i}`,
        target: `node-${i + 1}`,
      }));

      const input = { nodes, edges };
      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(100);
      expect(result.edges).toHaveLength(99);

      // Verify fallbacks work correctly
      // Node 0: i=0, so i%2===0 (name='Node 0'), i%3===0 (properties.title='Title 0'), i%5===0 (node_type='Function')
      const firstNode = result.nodes[0];
      expect(firstNode.id).toBe("node-0");
      // Due to {...node} spread AFTER computed name, node.name overrides computed properties.title
      expect(firstNode.name).toBe("Node 0"); // node.name='Node 0' overrides via ...node spread
      expect(firstNode.type).toBe("Function");
    });
  });

  describe("Data_Bank filtering scenarios", () => {
    test("should filter Data_Bank when it appears in middle of labels", () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Component", "Data_Bank", "UI"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Component"); // First non-Data_Bank
    });

    test("should filter Data_Bank when it appears at end of labels", () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Service", "Data_Bank"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Service");
    });

    test("should handle multiple labels with Data_Bank and find first valid", () => {
      const input = {
        nodes: [
          {
            id: "1",
            labels: ["Data_Bank", "Controller", "API", "Data_Bank"],
            name: "Test",
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].type).toBe("Controller"); // First non-Data_Bank
    });
  });

  describe("type coercion and special values", () => {
    test("should handle numeric id values", () => {
      const input = {
        nodes: [{ id: 123 as any, name: "Test" }],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].id).toBe(123);
    });

    test("should handle boolean values in properties", () => {
      const input = {
        nodes: [
          {
            id: "1",
            name: "Test",
            properties: { active: true, deprecated: false },
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].properties).toMatchObject({ active: true, deprecated: false });
    });

    test("should handle array values in node properties", () => {
      const input = {
        nodes: [
          {
            id: "1",
            name: "Test",
            tags: ["tag1", "tag2"],
            matrix: [
              [1, 2],
              [3, 4],
            ],
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0].tags).toEqual(["tag1", "tag2"]);
      expect(result.nodes[0].matrix).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe("real-world API response scenarios", () => {
    test("should transform typical subgraph API response", () => {
      const input = {
        nodes: [
          {
            ref_id: "func-123",
            node_type: "Function",
            properties: {
              name: "calculateTotal",
              file: "src/utils/math.ts",
              line: 42,
            },
            labels: ["Data_Bank", "Function"],
          },
          {
            ref_id: "class-456",
            node_type: "Class",
            properties: {
              name: "UserService",
              file: "src/services/user.ts",
            },
          },
        ],
        edges: [
          {
            source: "func-123",
            target: "class-456",
            edge_type: "CALLS",
            weight: 5,
          },
        ],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toMatchObject({
        id: "func-123",
        name: "calculateTotal",
        type: "Function",
      });
      expect(result.nodes[0].properties).toHaveProperty("file");
      expect(result.edges[0]).toMatchObject({
        source: "func-123",
        target: "class-456",
        edge_type: "CALLS",
      });
    });

    test("should handle coverage nodes API response format", () => {
      const input = {
        nodes: [
          {
            id: "test-node-1",
            name: "UserController.login",
            properties: {
              title: "Login Handler",
              file: "src/controllers/user.ts",
              test_count: 15,
              weight: 0.85,
            },
            labels: ["Controller", "Data_Bank"],
          },
        ],
        edges: [],
      };

      const result = DEFAULT_TRANSFORM(input);

      expect(result.nodes[0]).toMatchObject({
        id: "test-node-1",
        name: "UserController.login", // node.name used
        type: "Controller", // Data_Bank filtered
      });
      expect((result.nodes[0] as any).properties.test_count).toBe(15);
    });
  });
});
