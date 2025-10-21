import { describe, test, expect, beforeEach } from "vitest";
import { useDataStore } from "@/stores/useDataStore";

// Mock data factory for creating FetchDataResponse with configurable nodes/edges
const createMockNode = (refId: string, nodeType: string = "Function") => ({
  ref_id: refId,
  node_type: nodeType,
  x: 0,
  y: 0,
  z: 0,
  edge_count: 0,
  sources: [],
  targets: [],
  edgeTypes: [],
  properties: { name: `Node ${refId}` },
});

const createMockLink = (
  refId: string,
  source: string,
  target: string,
  edgeType: string = "calls"
) => ({
  ref_id: refId,
  source,
  target,
  edge_type: edgeType,
});

const createMockFetchData = (
  nodeCount: number,
  edgeCount: number = 0,
  options?: {
    nodeTypes?: string[];
    edgeTypes?: string[];
    createDisconnectedEdges?: boolean;
  }
) => {
  const nodeTypes = options?.nodeTypes || ["Function"];
  const edgeTypes = options?.edgeTypes || ["calls"];
  const nodes = Array(nodeCount)
    .fill(null)
    .map((_, i) => createMockNode(`node-${i}`, nodeTypes[i % nodeTypes.length]));

  const edges = Array(edgeCount)
    .fill(null)
    .map((_, i) => {
      if (options?.createDisconnectedEdges) {
        // Create edges with non-existent nodes
        return createMockLink(
          `edge-${i}`,
          `missing-source-${i}`,
          `missing-target-${i}`,
          edgeTypes[i % edgeTypes.length]
        );
      }
      // Create valid edges between existing nodes
      const sourceIndex = i % nodeCount;
      const targetIndex = (i + 1) % nodeCount;
      return createMockLink(
        `edge-${i}`,
        `node-${sourceIndex}`,
        `node-${targetIndex}`,
        edgeTypes[i % edgeTypes.length]
      );
    });

  return { nodes, edges };
};

// Helper to inspect store state
const inspectStore = () => {
  const state = useDataStore.getState();
  return {
    nodeCount: state.dataInitial?.nodes.length || 0,
    edgeCount: state.dataInitial?.links.length || 0,
    newNodeCount: state.dataNew?.nodes.length || 0,
    newEdgeCount: state.dataNew?.links.length || 0,
    normalizedNodeCount: state.nodesNormalized.size,
    normalizedLinkCount: state.linksNormalized.size,
    nodeTypes: state.nodeTypes,
    linkTypes: state.linkTypes,
    sidebarFilters: state.sidebarFilters,
    sidebarFilterCounts: state.sidebarFilterCounts,
    nodeLinksNormalizedKeys: Object.keys(state.nodeLinksNormalized),
  };
};

describe("useDataStore - addNewNode", () => {
  beforeEach(() => {
    // Reset store to clean state before each test
    useDataStore.getState().resetData();
  });

  describe("Basic Functionality", () => {
    test("should add new nodes to empty store", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(3);

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(3);
      expect(state.newNodeCount).toBe(3);
      expect(state.normalizedNodeCount).toBe(3);
    });

    test("should add new edges with valid source/target", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(3, 2);

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.edgeCount).toBe(2);
      expect(state.newEdgeCount).toBe(2);
      expect(state.normalizedLinkCount).toBe(2);
    });

    test("should handle nodes without edges", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(5, 0);

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(5);
      expect(state.edgeCount).toBe(0);
      expect(state.normalizedLinkCount).toBe(0);
    });

    test("should handle empty edges array", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = { nodes: [createMockNode("node-1")], edges: [] };

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(1);
      expect(state.edgeCount).toBe(0);
    });

    test("should handle missing edges property", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = { nodes: [createMockNode("node-1")] };

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(1);
      expect(state.edgeCount).toBe(0);
    });
  });

  describe("Node Deduplication", () => {
    test("should not add duplicate nodes (same ref_id)", () => {
      const { addNewNode } = useDataStore.getState();
      const node1 = createMockNode("node-1");
      const node2 = createMockNode("node-1"); // Duplicate ref_id

      addNewNode({ nodes: [node1] });
      addNewNode({ nodes: [node2] });

      const state = inspectStore();
      expect(state.nodeCount).toBe(1);
      expect(state.normalizedNodeCount).toBe(1);
    });

    test("should not add duplicate edges (same ref_id)", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edge1 = createMockLink("edge-1", "node-1", "node-2");
      const edge2 = createMockLink("edge-1", "node-1", "node-2"); // Duplicate ref_id

      addNewNode({ nodes, edges: [edge1] });
      addNewNode({ nodes: [], edges: [edge2] });

      const state = inspectStore();
      expect(state.edgeCount).toBe(1);
      expect(state.normalizedLinkCount).toBe(1);
    });

    test("should handle partial duplicates (some new, some existing)", () => {
      const { addNewNode } = useDataStore.getState();
      const initialData = createMockFetchData(2);
      const partialData = {
        nodes: [createMockNode("node-1"), createMockNode("node-3")], // node-1 duplicate, node-3 new
        edges: [],
      };

      addNewNode(initialData);
      addNewNode(partialData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(3); // Only node-3 added
      expect(state.normalizedNodeCount).toBe(3);
    });

    test("should preserve existing node data when duplicate detected", () => {
      const { addNewNode, nodesNormalized } = useDataStore.getState();
      const node1 = createMockNode("node-1");
      node1.properties = { name: "Original Name" };
      const node2 = createMockNode("node-1");
      node2.properties = { name: "Updated Name" };

      addNewNode({ nodes: [node1] });
      const originalNode = nodesNormalized.get("node-1");

      addNewNode({ nodes: [node2] });
      const state = useDataStore.getState();
      const currentNode = state.nodesNormalized.get("node-1");

      expect(currentNode?.properties?.name).toBe("Original Name"); // Original preserved
    });
  });

  describe("Edge Validation", () => {
    test("should reject edges with missing source node", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-2")];
      const edges = [createMockLink("edge-1", "missing-node", "node-2")];

      addNewNode({ nodes, edges });

      const state = inspectStore();
      expect(state.edgeCount).toBe(0); // Edge not added
    });

    test("should reject edges with missing target node", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1")];
      const edges = [createMockLink("edge-1", "node-1", "missing-node")];

      addNewNode({ nodes, edges });

      const state = inspectStore();
      expect(state.edgeCount).toBe(0);
    });

    test("should reject edges with both nodes missing", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1")];
      const edges = [createMockLink("edge-1", "missing-1", "missing-2")];

      addNewNode({ nodes, edges });

      const state = inspectStore();
      expect(state.edgeCount).toBe(0);
    });

    test("should add edges only when both source and target exist", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(3, 5, { createDisconnectedEdges: true });

      // First add nodes only
      addNewNode({ nodes: mockData.nodes });

      // Then add edges - some with valid nodes, some without
      const validEdges = [
        createMockLink("edge-1", "node-0", "node-1"),
        createMockLink("edge-2", "node-1", "node-2"),
      ];
      const invalidEdges = [
        createMockLink("edge-3", "missing-1", "node-0"),
        createMockLink("edge-4", "node-0", "missing-2"),
      ];

      addNewNode({ nodes: [], edges: [...validEdges, ...invalidEdges] });

      const state = inspectStore();
      expect(state.edgeCount).toBe(2); // Only 2 valid edges added
    });

    test("should handle self-referencing edges", () => {
      const { addNewNode } = useDataStore.getState();
      const node = createMockNode("node-1");
      const selfEdge = createMockLink("edge-1", "node-1", "node-1");

      addNewNode({ nodes: [node], edges: [selfEdge] });

      const state = inspectStore();
      expect(state.edgeCount).toBe(1);
      expect(state.normalizedLinkCount).toBe(1);
    });
  });

  describe("Relationship Tracking", () => {
    test("should update source node's targets array", () => {
      const { addNewNode, nodesNormalized } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [createMockLink("edge-1", "node-1", "node-2")];

      addNewNode({ nodes, edges });

      const state = useDataStore.getState();
      const sourceNode = state.nodesNormalized.get("node-1");
      expect(sourceNode?.targets).toContain("node-2");
    });

    test("should update target node's sources array", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [createMockLink("edge-1", "node-1", "node-2")];

      addNewNode({ nodes, edges });

      const state = useDataStore.getState();
      const targetNode = state.nodesNormalized.get("node-2");
      expect(targetNode?.sources).toContain("node-1");
    });

    test("should track edge types on both nodes", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [
        createMockLink("edge-1", "node-1", "node-2", "calls"),
        createMockLink("edge-2", "node-1", "node-2", "imports"),
      ];

      addNewNode({ nodes, edges });

      const state = useDataStore.getState();
      const sourceNode = state.nodesNormalized.get("node-1");
      const targetNode = state.nodesNormalized.get("node-2");

      expect(sourceNode?.edgeTypes).toContain("calls");
      expect(sourceNode?.edgeTypes).toContain("imports");
      expect(targetNode?.edgeTypes).toContain("calls");
      expect(targetNode?.edgeTypes).toContain("imports");
    });

    test("should handle multiple edges between same nodes", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [
        createMockLink("edge-1", "node-1", "node-2", "calls"),
        createMockLink("edge-2", "node-1", "node-2", "imports"),
        createMockLink("edge-3", "node-1", "node-2", "references"),
      ];

      addNewNode({ nodes, edges });

      const state = inspectStore();
      expect(state.edgeCount).toBe(3);

      const sourceNode = useDataStore.getState().nodesNormalized.get("node-1");
      expect(sourceNode?.targets?.filter((t) => t === "node-2").length).toBe(3);
    });

    test("should populate nodeLinksNormalized correctly", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [createMockLink("edge-1", "node-1", "node-2")];

      addNewNode({ nodes, edges });

      const state = useDataStore.getState();
      const pairKey = ["node-1", "node-2"].sort().join("--");
      expect(state.nodeLinksNormalized[pairKey]).toContain("edge-1");
    });

    test("should use sorted pair keys in nodeLinksNormalized", () => {
      // Ensure clean state
      useDataStore.getState().resetData();
      
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [
        createMockLink("edge-1", "node-1", "node-2"),
        createMockLink("edge-2", "node-2", "node-1"),
      ];

      addNewNode({ nodes, edges });

      const state = useDataStore.getState();
      // Both edges should use the same sorted key
      const pairKey = ["node-1", "node-2"].sort().join("--");
      expect(state.nodeLinksNormalized[pairKey]).toHaveLength(2);
      expect(state.nodeLinksNormalized[pairKey]).toContain("edge-1");
      expect(state.nodeLinksNormalized[pairKey]).toContain("edge-2");
    });
  });

  describe("Metadata Calculation", () => {
    test("should extract unique nodeTypes", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(6, 0, {
        nodeTypes: ["Function", "Class", "Endpoint"],
      });

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeTypes).toContain("Function");
      expect(state.nodeTypes).toContain("Class");
      expect(state.nodeTypes).toContain("Endpoint");
      expect(state.nodeTypes).toHaveLength(3);
    });

    test("should extract unique linkTypes", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(4, 6, {
        edgeTypes: ["calls", "imports", "extends"],
      });

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.linkTypes).toContain("calls");
      expect(state.linkTypes).toContain("imports");
      expect(state.linkTypes).toContain("extends");
      expect(state.linkTypes).toHaveLength(3);
    });

    test("should create sidebar filters", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(4, 0, {
        nodeTypes: ["Function", "Class"],
      });

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.sidebarFilters).toContain("all");
      expect(state.sidebarFilters).toContain("function");
      expect(state.sidebarFilters).toContain("class");
    });

    test("should calculate filter counts", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [
        createMockNode("node-1", "Function"),
        createMockNode("node-2", "Function"),
        createMockNode("node-3", "Class"),
      ];

      addNewNode({ nodes });

      const state = inspectStore();
      const allCount = state.sidebarFilterCounts.find((f) => f.name === "all");
      const functionCount = state.sidebarFilterCounts.find(
        (f) => f.name === "function"
      );
      const classCount = state.sidebarFilterCounts.find((f) => f.name === "class");

      expect(allCount?.count).toBe(3);
      expect(functionCount?.count).toBe(2);
      expect(classCount?.count).toBe(1);
    });

    test("should update metadata on incremental additions", () => {
      const { addNewNode } = useDataStore.getState();
      const firstBatch = createMockFetchData(2, 0, { nodeTypes: ["Function"] });
      const secondBatch = createMockFetchData(2, 0, { nodeTypes: ["Class"] });
      // Need to rename nodes to avoid duplication
      secondBatch.nodes = [createMockNode("node-3", "Class"), createMockNode("node-4", "Class")];

      addNewNode(firstBatch);
      addNewNode(secondBatch);

      const state = inspectStore();
      expect(state.nodeTypes).toContain("Function");
      expect(state.nodeTypes).toContain("Class");
      expect(state.nodeTypes).toHaveLength(2);

      const allCount = state.sidebarFilterCounts.find((f) => f.name === "all");
      expect(allCount?.count).toBe(4);
    });
  });

  describe("Incremental Updates", () => {
    test("should separate dataNew from dataInitial", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(3);

      addNewNode(mockData);

      const state = inspectStore();
      expect(state.nodeCount).toBe(3); // dataInitial
      expect(state.newNodeCount).toBe(3); // dataNew
    });

    test("should preserve existing data when adding new nodes", () => {
      const { addNewNode } = useDataStore.getState();
      const firstBatch = createMockFetchData(2);
      const secondBatch = {
        nodes: [createMockNode("node-3")],
        edges: [],
      };

      addNewNode(firstBatch);
      addNewNode(secondBatch);

      const state = inspectStore();
      expect(state.nodeCount).toBe(3); // All nodes preserved
      expect(state.newNodeCount).toBe(1); // Only new node in dataNew
    });

    test("should accumulate edges across multiple additions", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [
        createMockNode("node-1"),
        createMockNode("node-2"),
        createMockNode("node-3"),
      ];
      const firstEdges = [createMockLink("edge-1", "node-1", "node-2")];
      const secondEdges = [createMockLink("edge-2", "node-2", "node-3")];

      addNewNode({ nodes, edges: firstEdges });
      addNewNode({ nodes: [], edges: secondEdges });

      const state = inspectStore();
      expect(state.edgeCount).toBe(2);
      expect(state.normalizedLinkCount).toBe(2);
    });

    test("should maintain Map normalization across updates", () => {
      const { addNewNode } = useDataStore.getState();
      const firstBatch = createMockFetchData(2);
      const secondBatch = { nodes: [createMockNode("node-3")], edges: [] };

      addNewNode(firstBatch);
      const firstMapSize = useDataStore.getState().nodesNormalized.size;

      addNewNode(secondBatch);
      const secondMapSize = useDataStore.getState().nodesNormalized.size;

      expect(firstMapSize).toBe(2);
      expect(secondMapSize).toBe(3);
    });
  });

  describe("Early Exit Scenarios", () => {
    test("should not update store if no new data", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(2);

      addNewNode(mockData);
      const firstState = inspectStore();

      // Try adding same data again - the function should exit early
      // without calling set(), so dataNew remains unchanged from first call
      addNewNode(mockData);
      const secondState = inspectStore();

      expect(secondState.nodeCount).toBe(firstState.nodeCount);
      // dataNew should still contain nodes from first call since store wasn't updated
      expect(secondState.newNodeCount).toBe(firstState.newNodeCount);
    });

    test("should exit early when data is null", () => {
      const { addNewNode } = useDataStore.getState();

      // @ts-expect-error Testing invalid input
      addNewNode(null);

      const state = inspectStore();
      expect(state.nodeCount).toBe(0);
    });

    test("should exit early when data is undefined", () => {
      const { addNewNode } = useDataStore.getState();

      // @ts-expect-error Testing invalid input
      addNewNode(undefined);

      const state = inspectStore();
      expect(state.nodeCount).toBe(0);
    });

    test("should exit early when data.nodes is undefined", () => {
      const { addNewNode } = useDataStore.getState();

      // @ts-expect-error Testing invalid input
      addNewNode({});

      const state = inspectStore();
      expect(state.nodeCount).toBe(0);
    });

    test("should exit early when data.nodes is empty array and no existing data", () => {
      const { addNewNode } = useDataStore.getState();

      addNewNode({ nodes: [] });

      const state = inspectStore();
      expect(state.nodeCount).toBe(0);
    });

    test("should not update when all nodes and edges are duplicates", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(2, 1);

      addNewNode(mockData);
      const state1 = useDataStore.getState();
      const dataInitialRef1 = state1.dataInitial;

      addNewNode(mockData); // Add same data again
      const state2 = useDataStore.getState();
      const dataInitialRef2 = state2.dataInitial;

      // dataInitial reference should remain unchanged (no state update)
      expect(dataInitialRef1).toBe(dataInitialRef2);
    });
  });

  describe("Large Datasets & Performance", () => {
    test("should handle 1000+ nodes efficiently", () => {
      const { addNewNode } = useDataStore.getState();
      const mockData = createMockFetchData(1000, 500);

      const startTime = performance.now();
      addNewNode(mockData);
      const endTime = performance.now();

      const state = inspectStore();
      expect(state.nodeCount).toBe(1000);
      expect(state.edgeCount).toBe(500);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in less than 1 second
    });

    test("should maintain O(1) lookup performance with Maps", () => {
      const { addNewNode, nodesNormalized } = useDataStore.getState();
      const mockData = createMockFetchData(1000);

      addNewNode(mockData);

      const state = useDataStore.getState();
      // Verify Map is used for fast lookups
      expect(state.nodesNormalized.size).toBe(1000);
      expect(state.nodesNormalized.has("node-500")).toBe(true);
      expect(state.nodesNormalized.get("node-500")).toBeDefined();
    });

    test("should handle incremental additions to large datasets", () => {
      const { addNewNode } = useDataStore.getState();

      // Add initial large batch
      const initialBatch = createMockFetchData(500, 200);
      addNewNode(initialBatch);

      // Add incremental batch with unique ref_ids
      const incrementalBatch = {
        nodes: Array(100)
          .fill(null)
          .map((_, i) => createMockNode(`node-new-${i}`, "Function")),
        edges: [],
      };
      addNewNode(incrementalBatch);

      const state = inspectStore();
      expect(state.nodeCount).toBe(600); // 500 + 100
      expect(state.normalizedNodeCount).toBe(600);
    });

    test("should handle complex graph structures with cyclic dependencies", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [
        createMockNode("node-1"),
        createMockNode("node-2"),
        createMockNode("node-3"),
      ];
      const cyclicEdges = [
        createMockLink("edge-1", "node-1", "node-2"),
        createMockLink("edge-2", "node-2", "node-3"),
        createMockLink("edge-3", "node-3", "node-1"), // Cycle back to node-1
      ];

      addNewNode({ nodes, edges: cyclicEdges });

      const state = useDataStore.getState();
      expect(state.dataInitial?.links.length).toBe(3);

      // Verify bidirectional tracking works with cycles
      const node1 = state.nodesNormalized.get("node-1");
      expect(node1?.targets).toContain("node-2");
      expect(node1?.sources).toContain("node-3");
    });
  });

  describe("Edge Cases", () => {
    test("should handle nodes with no ref_id gracefully", () => {
      const { addNewNode } = useDataStore.getState();
      const invalidNode = { ...createMockNode("node-1") };
      // @ts-expect-error Testing invalid input
      delete invalidNode.ref_id;

      // This should not throw an error
      expect(() => {
        addNewNode({ nodes: [invalidNode] });
      }).not.toThrow();
    });

    test("should handle edges with no ref_id gracefully", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const invalidEdge = { ...createMockLink("edge-1", "node-1", "node-2") };
      // @ts-expect-error Testing invalid input
      delete invalidEdge.ref_id;

      expect(() => {
        addNewNode({ nodes, edges: [invalidEdge] });
      }).not.toThrow();
    });

    test("should handle mixed valid and invalid data", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edges = [
        createMockLink("edge-1", "node-1", "node-2"), // Valid
        createMockLink("edge-2", "missing", "node-2"), // Invalid source
        createMockLink("edge-3", "node-1", "missing"), // Invalid target
      ];

      addNewNode({ nodes, edges });

      const state = inspectStore();
      expect(state.nodeCount).toBe(2);
      expect(state.edgeCount).toBe(1); // Only valid edge added
    });

    test("should handle empty node types", () => {
      const { addNewNode } = useDataStore.getState();
      const node = createMockNode("node-1");
      // @ts-expect-error Testing edge case
      node.node_type = "";

      addNewNode({ nodes: [node] });

      const state = inspectStore();
      expect(state.nodeCount).toBe(1);
      expect(state.nodeTypes).toContain("");
    });

    test("should handle undefined edge_type", () => {
      const { addNewNode } = useDataStore.getState();
      const nodes = [createMockNode("node-1"), createMockNode("node-2")];
      const edge = createMockLink("edge-1", "node-1", "node-2");
      // @ts-expect-error Testing edge case
      edge.edge_type = undefined;

      addNewNode({ nodes, edges: [edge] });

      const state = useDataStore.getState();
      expect(state.dataInitial?.links[0].edge_type).toBeUndefined();
    });
  });
});