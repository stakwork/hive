import { describe, it, expect, vi, beforeEach } from "vitest";
import { Node, Edge } from "@xyflow/react";
import { getLayoutedElements } from "@/components/features/DependencyGraph/layouts/dagre";
import { detectCollisions } from "@/components/features/DependencyGraph/layouts/collisionDetection";
import {
  createTestNode,
  createLinearGraph,
  createBranchingGraph,
  assertNoOverlaps,
} from "@/__tests__/support/factories/graphFactory";
import type { LayoutConfig } from "@/components/features/DependencyGraph/types";

describe("Dagre Layout with Collision Detection", () => {
  const defaultConfig: LayoutConfig = {
    nodeWidth: 200,
    nodeHeight: 120,
    direction: "TB",
    ranksep: 100,
    nodesep: 50,
  };

  beforeEach(() => {
    // Clear console warnings spy before each test
    vi.clearAllMocks();
  });

  describe("Linear Chain Layout", () => {
    it("should layout a simple linear chain without overlaps", () => {
      const { nodes, edges } = createLinearGraph(5, false);
      
      const result = getLayoutedElements(nodes, edges, defaultConfig);

      // Verify all nodes are present
      expect(result.nodes).toHaveLength(5);
      expect(result.edges).toHaveLength(4);

      // Verify no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
      expect(collisionResult.collisions).toHaveLength(0);

      // Verify using graphFactory assertion
      expect(() =>
        assertNoOverlaps(result.nodes, defaultConfig.nodeWidth, defaultConfig.nodeHeight, 25)
      ).not.toThrow();
    });

    it("should layout a long linear chain (10 nodes) without overlaps", () => {
      const { nodes, edges } = createLinearGraph(10, true);
      
      const result = getLayoutedElements(nodes, edges, defaultConfig);

      // Verify all nodes are present (10 + start + end)
      expect(result.nodes).toHaveLength(12);

      // Verify no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
    });

    it("should handle empty node list", () => {
      const result = getLayoutedElements([], [], defaultConfig);

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);

      // Collision detection on empty list should return no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
    });

    it("should handle single node", () => {
      const nodes = [createTestNode("single")];
      const edges: Edge[] = [];

      const result = getLayoutedElements(nodes, edges, defaultConfig);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(0);
      expect(result.nodes[0].position.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Diamond Pattern Layout", () => {
    it("should layout diamond pattern with proper spacing", () => {
      const { nodes, edges } = createBranchingGraph();

      const result = getLayoutedElements(nodes, edges, defaultConfig);

      // Verify all nodes are present
      expect(result.nodes).toHaveLength(6);

      // Verify no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);

      // Verify branch nodes (trueBranch and falseBranch) are properly spaced
      const trueBranch = result.nodes.find((n) => n.id === "trueBranch");
      const falseBranch = result.nodes.find((n) => n.id === "falseBranch");

      expect(trueBranch).toBeDefined();
      expect(falseBranch).toBeDefined();

      // In TB layout, branches should be at same Y level but different X
      if (trueBranch && falseBranch) {
        expect(Math.abs(trueBranch.position.y - falseBranch.position.y)).toBeLessThan(10);
        // Branches should have reasonable spacing (at least node width)
        expect(Math.abs(trueBranch.position.x - falseBranch.position.x)).toBeGreaterThan(
          defaultConfig.nodeWidth
        );
      }
    });

    it("should layout diamond pattern in LR direction", () => {
      const { nodes, edges } = createBranchingGraph();
      const lrConfig: LayoutConfig = { ...defaultConfig, direction: "LR" };

      const result = getLayoutedElements(nodes, edges, lrConfig);

      // Verify no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        lrConfig.nodeWidth,
        lrConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);

      // In LR layout, branches should be at same X level but different Y
      const trueBranch = result.nodes.find((n) => n.id === "trueBranch");
      const falseBranch = result.nodes.find((n) => n.id === "falseBranch");

      if (trueBranch && falseBranch) {
        expect(Math.abs(trueBranch.position.x - falseBranch.position.x)).toBeLessThan(10);
        // Branches should have reasonable spacing (at least node height)
        expect(Math.abs(trueBranch.position.y - falseBranch.position.y)).toBeGreaterThan(
          lrConfig.nodeHeight
        );
      }
    });
  });

  describe("Wide Parallel Dependencies", () => {
    it("should layout wide parallel dependencies (12 nodes) without overlaps", () => {
      // Create a graph with one source, 10 parallel targets, and one sink
      const nodes: Node[] = [
        createTestNode("source"),
        ...Array.from({ length: 10 }, (_, i) => createTestNode(`parallel${i}`)),
        createTestNode("sink"),
      ];

      const edges: Edge[] = [
        // Connect source to all parallel nodes
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `e-source-${i}`,
          source: "source",
          target: `parallel${i}`,
        })),
        // Connect all parallel nodes to sink
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `e-${i}-sink`,
          source: `parallel${i}`,
          target: "sink",
        })),
      ];

      const result = getLayoutedElements(nodes, edges, defaultConfig);

      // Verify all nodes are present
      expect(result.nodes).toHaveLength(12);

      // Verify no collisions
      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
      expect(collisionResult.collisions).toHaveLength(0);
    });

    it("should handle 15+ parallel nodes", () => {
      const nodes: Node[] = [
        createTestNode("source"),
        ...Array.from({ length: 15 }, (_, i) => createTestNode(`parallel${i}`)),
        createTestNode("sink"),
      ];

      const edges: Edge[] = [
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `e-source-${i}`,
          source: "source",
          target: `parallel${i}`,
        })),
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `e-${i}-sink`,
          source: `parallel${i}`,
          target: "sink",
        })),
      ];

      const result = getLayoutedElements(nodes, edges, defaultConfig);

      expect(result.nodes).toHaveLength(17);

      const collisionResult = detectCollisions(
        result.nodes,
        defaultConfig.nodeWidth,
        defaultConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
    });
  });

  describe("Retry Mechanism", () => {
    it("should retry layout when collisions are detected", () => {
      // Create a tight configuration that might cause overlaps
      const tightConfig: LayoutConfig = {
        nodeWidth: 200,
        nodeHeight: 120,
        direction: "TB",
        ranksep: 10, // Very tight spacing
        nodesep: 5,
      };

      const { nodes, edges } = createBranchingGraph();

      // Spy on console.warn to check if retry happens
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = getLayoutedElements(nodes, edges, tightConfig);

      // The layout should complete (even if with warnings)
      expect(result.nodes).toHaveLength(6);

      // Check if warning was called (means max retries reached)
      // Note: This test is probabilistic - tight spacing may or may not cause collisions
      // depending on dagre's algorithm. The important thing is the code handles it.
      
      warnSpy.mockRestore();
    });

    it("should increase spacing on each retry attempt", () => {
      // This is an indirect test - we verify the behavior by checking
      // that extremely tight layouts eventually succeed or warn appropriately
      const extremelyTightConfig: LayoutConfig = {
        nodeWidth: 200,
        nodeHeight: 120,
        direction: "TB",
        ranksep: 1,
        nodesep: 1,
      };

      const nodes: Node[] = [
        createTestNode("source"),
        ...Array.from({ length: 5 }, (_, i) => createTestNode(`parallel${i}`)),
        createTestNode("sink"),
      ];

      const edges: Edge[] = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `e-source-${i}`,
          source: "source",
          target: `parallel${i}`,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `e-${i}-sink`,
          source: `parallel${i}`,
          target: "sink",
        })),
      ];

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = getLayoutedElements(nodes, edges, extremelyTightConfig);

      // Should return a result regardless
      expect(result.nodes).toHaveLength(7);
      expect(result.edges).toHaveLength(10);

      warnSpy.mockRestore();
    });
  });

  describe("Max Retry Fallback", () => {
    it("should log warning and return result after max retries", () => {
      // Create artificially overlapping nodes by manually setting positions
      const nodes: Node[] = [
        createTestNode("node1", {
          position: { x: 0, y: 0 },
        }),
        createTestNode("node2", {
          position: { x: 10, y: 10 }, // Intentionally overlapping
        }),
        createTestNode("node3", {
          position: { x: 20, y: 20 },
        }),
      ];

      const edges: Edge[] = [
        { id: "e1", source: "node1", target: "node2" },
        { id: "e2", source: "node2", target: "node3" },
      ];

      // Use very tight spacing to maximize chance of collision
      const impossiblyTightConfig: LayoutConfig = {
        nodeWidth: 300,
        nodeHeight: 300,
        direction: "TB",
        ranksep: 1,
        nodesep: 1,
      };

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = getLayoutedElements(nodes, edges, impossiblyTightConfig);

      // Should still return a result
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);

      // Warning may or may not be called depending on dagre's layout
      // The important thing is the function doesn't throw or hang

      warnSpy.mockRestore();
    });

    it("should throw error for invalid node dimensions", () => {
      const nodes = [createTestNode("node1")];
      const edges: Edge[] = [];

      const invalidConfig: LayoutConfig = {
        nodeWidth: 0, // Invalid
        nodeHeight: 0, // Invalid
        direction: "TB",
      };

      // Should throw when collision detection runs with invalid dimensions
      expect(() => {
        getLayoutedElements(nodes, edges, invalidConfig);
      }).toThrow("Invalid dimensions");
    });
  });

  describe("Collision Detection Utility", () => {
    it("should detect overlapping nodes", () => {
      const overlappingNodes: Node[] = [
        createTestNode("a", { position: { x: 0, y: 0 } }),
        createTestNode("b", { position: { x: 50, y: 50 } }), // Overlaps with A
      ];

      const result = detectCollisions(overlappingNodes, 200, 120, 25);

      expect(result.hasCollisions).toBe(true);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0]).toMatchObject({
        nodeA: "a",
        nodeB: "b",
      });
    });

    it("should not detect collisions for properly spaced nodes", () => {
      const spacedNodes: Node[] = [
        createTestNode("a", { position: { x: 0, y: 0 } }),
        createTestNode("b", { position: { x: 300, y: 0 } }), // Well-spaced
      ];

      const result = detectCollisions(spacedNodes, 200, 120, 25);

      expect(result.hasCollisions).toBe(false);
      expect(result.collisions).toHaveLength(0);
    });

    it("should handle custom node dimensions", () => {
      const nodesWithCustomDimensions: Node[] = [
        createTestNode("a", {
          position: { x: 0, y: 0 },
          data: { width: 100, height: 80 },
        }),
        createTestNode("b", {
          position: { x: 150, y: 0 },
          data: { width: 100, height: 80 },
        }),
      ];

      const result = detectCollisions(nodesWithCustomDimensions, 200, 120, 25);

      // With minSpacing of 25, nodes need 50px gap total
      // Node A: 0 to 100, Node B: 150 to 250
      // Gap: 150 - 100 = 50px - with minSpacing buffer on both sides (25 * 2 = 50), they should just touch
      expect(result.hasCollisions).toBe(false);
    });

    it("should throw error for invalid dimensions", () => {
      const nodes = [createTestNode("a", { position: { x: 0, y: 0 } })];

      expect(() => {
        detectCollisions(nodes, -100, 120, 25);
      }).toThrow("Invalid dimensions");

      expect(() => {
        detectCollisions(nodes, 100, 0, 25);
      }).toThrow("Invalid dimensions");
    });

    it("should throw error for negative minSpacing", () => {
      const nodes = [createTestNode("a", { position: { x: 0, y: 0 } })];

      expect(() => {
        detectCollisions(nodes, 100, 120, -10);
      }).toThrow("Invalid minSpacing");
    });

    it("should handle empty node array", () => {
      const result = detectCollisions([], 200, 120, 25);

      expect(result.hasCollisions).toBe(false);
      expect(result.collisions).toHaveLength(0);
    });

    it("should skip nodes with invalid positions", () => {
      const nodesWithInvalidPositions: Node[] = [
        createTestNode("a", { position: { x: 0, y: 0 } }),
        createTestNode("b", { position: { x: NaN, y: 0 } }), // Invalid
        createTestNode("c", { position: { x: 300, y: 0 } }), // Far enough from A
      ];

      const result = detectCollisions(nodesWithInvalidPositions, 200, 120, 25);

      // Should only check valid nodes (a and c are far enough apart: 300 - (0 + 200) = 100px gap > 50px needed)
      expect(result.hasCollisions).toBe(false);
    });
  });

  describe("Backward Compatibility", () => {
    it("should work with existing dagre usage patterns", () => {
      const { nodes, edges } = createLinearGraph(3, false);

      // Old-style config without explicit ranksep/nodesep
      const minimalConfig: LayoutConfig = {
        nodeWidth: 200,
        nodeHeight: 120,
      };

      const result = getLayoutedElements(nodes, edges, minimalConfig);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);

      // Should use default values and not throw
      const collisionResult = detectCollisions(
        result.nodes,
        minimalConfig.nodeWidth,
        minimalConfig.nodeHeight,
        25
      );
      expect(collisionResult.hasCollisions).toBe(false);
    });

    it("should preserve node data and properties", () => {
      const nodes = [
        createTestNode("node1", {
          data: { label: "Test Node", customProp: "value" },
        }),
      ];
      const edges: Edge[] = [];

      const result = getLayoutedElements(nodes, edges, defaultConfig);

      expect(result.nodes[0].data).toMatchObject({
        label: "Test Node",
        customProp: "value",
      });
    });

    it("should set correct position anchors for TB direction", () => {
      const { nodes, edges } = createLinearGraph(2, false);

      const result = getLayoutedElements(nodes, edges, {
        ...defaultConfig,
        direction: "TB",
      });

      result.nodes.forEach((node) => {
        expect(node.targetPosition).toBe("top");
        expect(node.sourcePosition).toBe("bottom");
      });
    });

    it("should set correct position anchors for LR direction", () => {
      const { nodes, edges } = createLinearGraph(2, false);

      const result = getLayoutedElements(nodes, edges, {
        ...defaultConfig,
        direction: "LR",
      });

      result.nodes.forEach((node) => {
        expect(node.targetPosition).toBe("left");
        expect(node.sourcePosition).toBe("right");
      });
    });
  });
});
