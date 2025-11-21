import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as d3 from "d3";
import {
  getNodeColor,
  filterValidLinks,
  getConnectedNodeIds,
  addArrowMarker,
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
      const links: D3Link[] = [{ source: "node1", target: "node2" }];

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
      const links: D3Link[] = [{ source: "node1", target: "node2", weight: 5, label: "test" }];

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

      const links: D3Link[] = [{ source: node1, target: node2 }];

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

  describe("addArrowMarker", () => {
    let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

    beforeEach(() => {
      // Create fresh SVG element for each test
      svg = d3.select(document.body).append("svg").attr("width", 800).attr("height", 600);
    });

    afterEach(() => {
      // Clean up SVG element after each test
      svg.remove();
    });

    describe("SVG marker structure creation", () => {
      test("should create defs element", () => {
        addArrowMarker(svg);

        const defs = svg.select("defs");
        expect(defs.empty()).toBe(false);
      });

      test("should create marker element with correct id", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.empty()).toBe(false);
        expect(marker.attr("id")).toBe("arrowhead");
      });

      test("should create marker with correct viewBox", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.attr("viewBox")).toBe("0 -5 10 10");
      });

      test("should create marker with correct reference points", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.attr("refX")).toBe("20");
        expect(marker.attr("refY")).toBe("0");
      });

      test("should create marker with correct dimensions", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.attr("markerWidth")).toBe("6");
        expect(marker.attr("markerHeight")).toBe("6");
      });

      test("should create marker with auto orientation", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.attr("orient")).toBe("auto");
      });

      test("should create complete marker structure in single call", () => {
        addArrowMarker(svg);

        const defs = svg.select("defs");
        const marker = defs.select("marker");

        expect(defs.empty()).toBe(false);
        expect(marker.empty()).toBe(false);
        expect(marker.attr("id")).toBe("arrowhead");
        expect(marker.attr("viewBox")).toBe("0 -5 10 10");
        expect(marker.attr("refX")).toBe("20");
        expect(marker.attr("refY")).toBe("0");
        expect(marker.attr("markerWidth")).toBe("6");
        expect(marker.attr("markerHeight")).toBe("6");
        expect(marker.attr("orient")).toBe("auto");
      });
    });

    describe("Arrow path element", () => {
      test("should create path element inside marker", () => {
        addArrowMarker(svg);

        const path = svg.select("marker path");
        expect(path.empty()).toBe(false);
      });

      test("should create path with correct arrow shape", () => {
        addArrowMarker(svg);

        const path = svg.select("marker path");
        expect(path.attr("d")).toBe("M0,-5L10,0L0,5");
      });

      test("should create path with correct fill color", () => {
        addArrowMarker(svg);

        const path = svg.select("marker path");
        expect(path.attr("fill")).toBe("#999");
      });

      test("should create single path element", () => {
        addArrowMarker(svg);

        const paths = svg.selectAll("marker path");
        expect(paths.size()).toBe(1);
      });
    });

    describe("Marker reusability", () => {
      test("should allow marker to be referenced by id", () => {
        addArrowMarker(svg);

        const marker = svg.select("#arrowhead");
        expect(marker.empty()).toBe(false);
        expect(marker.node()?.nodeName).toBe("marker");
      });

      test("should create marker that can be used with url() reference", () => {
        addArrowMarker(svg);

        // Create a test line that references the marker
        const line = svg
          .append("line")
          .attr("x1", 0)
          .attr("y1", 0)
          .attr("x2", 100)
          .attr("y2", 100)
          .attr("marker-end", "url(#arrowhead)");

        expect(line.attr("marker-end")).toBe("url(#arrowhead)");

        // Verify the marker exists for the reference
        const marker = svg.select("#arrowhead");
        expect(marker.empty()).toBe(false);
      });
    });

    describe("Multiple calls and duplicate prevention", () => {
      test("should handle multiple calls by creating multiple defs", () => {
        addArrowMarker(svg);
        addArrowMarker(svg);

        const defsElements = svg.selectAll("defs");
        // Note: Current implementation does not prevent duplicates
        // This test documents existing behavior
        expect(defsElements.size()).toBeGreaterThanOrEqual(1);
      });

      test("should create marker on second call even if first succeeded", () => {
        addArrowMarker(svg);
        addArrowMarker(svg);

        // At least one marker should exist
        const markers = svg.selectAll("marker");
        expect(markers.size()).toBeGreaterThanOrEqual(1);
      });
    });

    describe("Integration with SVG container", () => {
      test("should work with empty SVG element", () => {
        const emptySvg = d3.select(document.body).append("svg");

        addArrowMarker(emptySvg);

        const marker = emptySvg.select("marker");
        expect(marker.empty()).toBe(false);
        expect(marker.attr("id")).toBe("arrowhead");

        emptySvg.remove();
      });

      test("should work with SVG that already has content", () => {
        svg.append("circle").attr("cx", 50).attr("cy", 50).attr("r", 10);

        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.empty()).toBe(false);

        // Verify existing content is preserved
        const circle = svg.select("circle");
        expect(circle.empty()).toBe(false);
      });

      test("should append defs to root SVG element", () => {
        addArrowMarker(svg);

        const defs = svg.select("defs");
        expect(defs.empty()).toBe(false);

        // Verify defs is direct child of SVG
        const parent = d3.select(defs.node()?.parentNode as Element);
        expect(parent.node()).toBe(svg.node());
      });
    });

    describe("Error handling and edge cases", () => {
      test("should not throw with valid SVG selection", () => {
        expect(() => addArrowMarker(svg)).not.toThrow();
      });

      test("should handle SVG with existing defs element", () => {
        svg.append("defs");

        addArrowMarker(svg);

        // Should create another defs (current behavior - no duplicate prevention)
        const defsElements = svg.selectAll("defs");
        expect(defsElements.size()).toBeGreaterThanOrEqual(1);
      });

      test("should create marker in SVG with viewBox", () => {
        svg.attr("viewBox", "0 0 800 600");

        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.empty()).toBe(false);
        expect(marker.attr("id")).toBe("arrowhead");
      });

      test("should create marker in scaled SVG", () => {
        svg.attr("transform", "scale(2)");

        addArrowMarker(svg);

        const marker = svg.select("marker");
        expect(marker.empty()).toBe(false);
        expect(marker.attr("id")).toBe("arrowhead");
      });
    });

    describe("Marker attributes completeness", () => {
      test("should create marker with all required attributes for proper rendering", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");
        const path = marker.select("path");

        // Verify all attributes are set
        expect(marker.attr("id")).toBeTruthy();
        expect(marker.attr("viewBox")).toBeTruthy();
        expect(marker.attr("refX")).toBeTruthy();
        expect(marker.attr("refY")).not.toBeNull();
        expect(marker.attr("markerWidth")).toBeTruthy();
        expect(marker.attr("markerHeight")).toBeTruthy();
        expect(marker.attr("orient")).toBeTruthy();
        expect(path.attr("d")).toBeTruthy();
        expect(path.attr("fill")).toBeTruthy();
      });

      test("should create marker with numeric attribute values", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker");

        // Verify numeric attributes can be parsed
        expect(Number(marker.attr("refX"))).toBe(20);
        expect(Number(marker.attr("refY"))).toBe(0);
        expect(Number(marker.attr("markerWidth"))).toBe(6);
        expect(Number(marker.attr("markerHeight"))).toBe(6);
      });
    });

    describe("DOM structure validation", () => {
      test("should create proper parent-child hierarchy", () => {
        addArrowMarker(svg);

        const defs = svg.select("defs");
        const marker = defs.select("marker");
        const path = marker.select("path");

        // Verify hierarchy: svg > defs > marker > path
        expect(defs.empty()).toBe(false);
        expect(marker.empty()).toBe(false);
        expect(path.empty()).toBe(false);

        // Verify parent relationships
        expect(marker.node()?.parentElement).toBe(defs.node());
        expect(path.node()?.parentElement).toBe(marker.node());
      });

      test("should create SVG-namespaced elements", () => {
        addArrowMarker(svg);

        const marker = svg.select("marker").node();
        const path = svg.select("marker path").node();

        expect(marker?.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(path?.namespaceURI).toBe("http://www.w3.org/2000/svg");
      });
    });
  });
});
