import { describe, test, expect, vi, beforeEach } from "vitest";
import * as d3 from "d3";
import {
  getNodeColor,
  filterValidLinks,
  getConnectedNodeIds,
  DEFAULT_COLORS,
  type D3Node,
  type D3Link,
} from "@/components/graph/graphUtils";

describe("graphUtils", () => {
  describe("DEFAULT_COLORS", () => {
    test("should contain original type colors", () => {
      expect(DEFAULT_COLORS.Hint).toBe("#3b82f6");
      expect(DEFAULT_COLORS.Prompt).toBe("#10b981");
      expect(DEFAULT_COLORS.File).toBe("#f59e0b");
      expect(DEFAULT_COLORS.Function).toBe("#8b5cf6");
      expect(DEFAULT_COLORS.Endpoint).toBe("#ef4444");
      expect(DEFAULT_COLORS.Datamodel).toBe("#06b6d4");
      expect(DEFAULT_COLORS.Request).toBe("#ec4899");
      expect(DEFAULT_COLORS.Learning).toBe("#84cc16");
      expect(DEFAULT_COLORS.Task).toBe("#f97316");
    });

    test("should contain repository and package structure colors", () => {
      expect(DEFAULT_COLORS.Repository).toBe("#1e40af");
      expect(DEFAULT_COLORS.Package).toBe("#0891b2");
      expect(DEFAULT_COLORS.Language).toBe("#0d9488");
      expect(DEFAULT_COLORS.Directory).toBe("#f59e0b");
    });

    test("should contain code organization colors", () => {
      expect(DEFAULT_COLORS.Import).toBe("#7c3aed");
      expect(DEFAULT_COLORS.Library).toBe("#9333ea");
      expect(DEFAULT_COLORS.Class).toBe("#a855f7");
      expect(DEFAULT_COLORS.Trait).toBe("#c084fc");
      expect(DEFAULT_COLORS.Instance).toBe("#d8b4fe");
    });

    test("should contain feature and page colors", () => {
      expect(DEFAULT_COLORS.Feature).toBe("#059669");
      expect(DEFAULT_COLORS.Page).toBe("#10b981");
      expect(DEFAULT_COLORS.Var).toBe("#34d399");
    });

    test("should contain test type colors", () => {
      expect(DEFAULT_COLORS.UnitTest).toBe("#fbbf24");
      expect(DEFAULT_COLORS.IntegrationTest).toBe("#f59e0b");
      expect(DEFAULT_COLORS.E2eTest).toBe("#f97316");
    });
  });

  describe("getNodeColor", () => {
    test("should return default color for known type without custom colorMap", () => {
      expect(getNodeColor("Hint")).toBe("#3b82f6");
      expect(getNodeColor("Function")).toBe("#8b5cf6");
      expect(getNodeColor("Repository")).toBe("#1e40af");
    });

    test("should return fallback gray color for unknown type", () => {
      expect(getNodeColor("UnknownType")).toBe("#6b7280");
      expect(getNodeColor("RandomType")).toBe("#6b7280");
      expect(getNodeColor("")).toBe("#6b7280");
    });

    test("should use custom colorMap when provided", () => {
      const customColors = {
        CustomType: "#ff0000",
        Hint: "#00ff00",
      };

      expect(getNodeColor("CustomType", customColors)).toBe("#ff0000");
      expect(getNodeColor("Hint", customColors)).toBe("#00ff00");
    });

    test("should fallback to gray when type not in custom colorMap", () => {
      const customColors = {
        CustomType: "#ff0000",
      };

      expect(getNodeColor("Hint", customColors)).toBe("#6b7280");
      expect(getNodeColor("UnknownType", customColors)).toBe("#6b7280");
    });

    test("should handle empty custom colorMap", () => {
      const emptyColors = {};

      expect(getNodeColor("Hint", emptyColors)).toBe("#6b7280");
      expect(getNodeColor("Function", emptyColors)).toBe("#6b7280");
    });
  });

  describe("filterValidLinks", () => {
    test("should filter out links with missing source nodes", () => {
      const nodeIds = new Set(["node1", "node2", "node3"]);
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node4", target: "node2" }, // node4 doesn't exist
        { source: "node2", target: "node3" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ source: "node1", target: "node2" });
      expect(result).toContainEqual({ source: "node2", target: "node3" });
    });

    test("should filter out links with missing target nodes", () => {
      const nodeIds = new Set(["node1", "node2", "node3"]);
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node1", target: "node5" }, // node5 doesn't exist
        { source: "node2", target: "node3" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ source: "node1", target: "node2" });
      expect(result).toContainEqual({ source: "node2", target: "node3" });
    });

    test("should handle links with D3Node objects as source and target", () => {
      const nodeIds = new Set(["node1", "node2", "node3"]);
      const node1: D3Node = { id: "node1", name: "Node 1", type: "Hint" };
      const node2: D3Node = { id: "node2", name: "Node 2", type: "Function" };
      const node5: D3Node = { id: "node5", name: "Node 5", type: "File" };

      const links: D3Link[] = [
        { source: node1, target: node2 },
        { source: node1, target: node5 }, // node5 doesn't exist in nodeIds
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe(node1);
      expect(result[0].target).toBe(node2);
    });

    test("should handle mixed string and D3Node source/target", () => {
      const nodeIds = new Set(["node1", "node2", "node3"]);
      const node2: D3Node = { id: "node2", name: "Node 2", type: "Function" };

      const links: D3Link[] = [
        { source: "node1", target: node2 },
        { source: node2, target: "node3" },
        { source: "node1", target: "node4" }, // node4 doesn't exist
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(2);
    });

    test("should return empty array when no valid links exist", () => {
      const nodeIds = new Set(["node1", "node2"]);
      const links: D3Link[] = [
        { source: "node3", target: "node4" },
        { source: "node5", target: "node6" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(0);
    });

    test("should return all links when all are valid", () => {
      const nodeIds = new Set(["node1", "node2", "node3"]);
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node2", target: "node3" },
        { source: "node3", target: "node1" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(3);
      expect(result).toEqual(links);
    });

    test("should handle empty links array", () => {
      const nodeIds = new Set(["node1", "node2"]);
      const links: D3Link[] = [];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(0);
    });

    test("should handle empty nodeIds set", () => {
      const nodeIds = new Set<string>();
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(0);
    });
  });

  describe("getConnectedNodeIds", () => {
    test("should return nodes connected as targets", () => {
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node1", target: "node3" },
        { source: "node4", target: "node5" },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(2);
      expect(result.has("node2")).toBe(true);
      expect(result.has("node3")).toBe(true);
      expect(result.has("node4")).toBe(false);
    });

    test("should return nodes connected as sources", () => {
      const links: D3Link[] = [
        { source: "node2", target: "node1" },
        { source: "node3", target: "node1" },
        { source: "node4", target: "node5" },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(2);
      expect(result.has("node2")).toBe(true);
      expect(result.has("node3")).toBe(true);
      expect(result.has("node4")).toBe(false);
    });

    test("should return nodes connected in both directions", () => {
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node3", target: "node1" },
        { source: "node1", target: "node4" },
        { source: "node5", target: "node1" },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(4);
      expect(result.has("node2")).toBe(true);
      expect(result.has("node3")).toBe(true);
      expect(result.has("node4")).toBe(true);
      expect(result.has("node5")).toBe(true);
    });

    test("should handle D3Node objects as source and target", () => {
      const node1: D3Node = { id: "node1", name: "Node 1", type: "Hint" };
      const node2: D3Node = { id: "node2", name: "Node 2", type: "Function" };
      const node3: D3Node = { id: "node3", name: "Node 3", type: "File" };

      const links: D3Link[] = [
        { source: node1, target: node2 },
        { source: node3, target: node1 },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(2);
      expect(result.has("node2")).toBe(true);
      expect(result.has("node3")).toBe(true);
    });

    test("should handle mixed string and D3Node source/target", () => {
      const node2: D3Node = { id: "node2", name: "Node 2", type: "Function" };

      const links: D3Link[] = [
        { source: "node1", target: node2 },
        { source: node2, target: "node3" },
      ];

      const result = getConnectedNodeIds("node2", links);

      expect(result.size).toBe(2);
      expect(result.has("node1")).toBe(true);
      expect(result.has("node3")).toBe(true);
    });

    test("should return empty set when node has no connections", () => {
      const links: D3Link[] = [
        { source: "node2", target: "node3" },
        { source: "node4", target: "node5" },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(0);
    });

    test("should return empty set for empty links array", () => {
      const links: D3Link[] = [];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(0);
    });

    test("should handle self-referencing links", () => {
      const links: D3Link[] = [
        { source: "node1", target: "node1" },
        { source: "node1", target: "node2" },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(2);
      expect(result.has("node1")).toBe(true); // self-reference
      expect(result.has("node2")).toBe(true);
    });

    test("should handle duplicate connections", () => {
      const links: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node1", target: "node2" }, // duplicate
        { source: "node2", target: "node1" },
      ];

      const result = getConnectedNodeIds("node1", links);

      // Set should deduplicate
      expect(result.size).toBe(1);
      expect(result.has("node2")).toBe(true);
    });
  });

  describe("Integration scenarios", () => {
    test("should work with filterValidLinks and getConnectedNodeIds together", () => {
      const nodeIds = new Set(["node1", "node2", "node3", "node4"]);
      const allLinks: D3Link[] = [
        { source: "node1", target: "node2" },
        { source: "node1", target: "node5" }, // invalid
        { source: "node2", target: "node3" },
        { source: "node3", target: "node4" },
      ];

      const validLinks = filterValidLinks(allLinks, nodeIds);
      expect(validLinks).toHaveLength(3);

      const connectedToNode1 = getConnectedNodeIds("node1", validLinks);
      expect(connectedToNode1.size).toBe(1);
      expect(connectedToNode1.has("node2")).toBe(true);
    });

    test("should handle complex graph with multiple node types", () => {
      const nodeIds = new Set(["hint1", "func1", "file1", "endpoint1"]);
      const links: D3Link[] = [
        { source: "hint1", target: "func1" },
        { source: "func1", target: "file1" },
        { source: "file1", target: "endpoint1" },
        { source: "endpoint1", target: "hint1" },
      ];

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(4);

      // Test connectivity for each node
      const connectedToHint1 = getConnectedNodeIds("hint1", validLinks);
      expect(connectedToHint1.size).toBe(2); // func1 and endpoint1

      const connectedToFunc1 = getConnectedNodeIds("func1", validLinks);
      expect(connectedToFunc1.size).toBe(2); // hint1 and file1
    });

    test("should handle disconnected subgraphs", () => {
      const nodeIds = new Set(["a1", "a2", "b1", "b2"]);
      const links: D3Link[] = [
        { source: "a1", target: "a2" },
        { source: "b1", target: "b2" },
      ];

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(2);

      const connectedToA1 = getConnectedNodeIds("a1", validLinks);
      expect(connectedToA1.size).toBe(1);
      expect(connectedToA1.has("a2")).toBe(true);
      expect(connectedToA1.has("b1")).toBe(false);

      const connectedToB1 = getConnectedNodeIds("b1", validLinks);
      expect(connectedToB1.size).toBe(1);
      expect(connectedToB1.has("b2")).toBe(true);
      expect(connectedToB1.has("a1")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    test("getNodeColor should handle null/undefined gracefully", () => {
      // @ts-expect-error Testing edge case with undefined
      expect(getNodeColor(undefined)).toBe("#6b7280");
      // @ts-expect-error Testing edge case with null
      expect(getNodeColor(null)).toBe("#6b7280");
    });

    test("filterValidLinks should handle links with additional properties", () => {
      const nodeIds = new Set(["node1", "node2"]);
      const links: D3Link[] = [
        { source: "node1", target: "node2", weight: 5, label: "test" },
      ];

      const result = filterValidLinks(links, nodeIds);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("weight", 5);
      expect(result[0]).toHaveProperty("label", "test");
    });

    test("getConnectedNodeIds should handle nodes with additional properties", () => {
      const node1: D3Node = {
        id: "node1",
        name: "Node 1",
        type: "Hint",
        customProp: "value",
        layer: 1,
      };
      const node2: D3Node = {
        id: "node2",
        name: "Node 2",
        type: "Function",
        customProp: "value2",
      };

      const links: D3Link[] = [
        { source: node1, target: node2 },
      ];

      const result = getConnectedNodeIds("node1", links);

      expect(result.size).toBe(1);
      expect(result.has("node2")).toBe(true);
    });

    test("should handle very large graphs", () => {
      const numNodes = 1000;
      const nodeIds = new Set<string>();
      for (let i = 0; i < numNodes; i++) {
        nodeIds.add(`node${i}`);
      }

      const links: D3Link[] = [];
      for (let i = 0; i < numNodes - 1; i++) {
        links.push({ source: `node${i}`, target: `node${i + 1}` });
      }

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(numNodes - 1);

      const connectedToMiddle = getConnectedNodeIds("node500", validLinks);
      expect(connectedToMiddle.size).toBe(2); // node499 and node501
    });
  });
});
