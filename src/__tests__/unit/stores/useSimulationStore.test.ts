import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeExtended, Link } from "@Universe/types";

// Import mock for environment variables
import "@/__tests__/support/mocks/env";

/**
 * Unit tests for useSimulationStore - addClusterForce function
 * 
 * Tests the cluster-based 3D force layout logic that:
 * - Distributes neighborhood centers on a sphere (radius 3000)
 * - Resets all node positions before applying forces
 * - Configures D3 forces with specific parameters
 */

// Mock d3-force-3d library
const mockForceManyBody = vi.fn();
const mockForceX = vi.fn();
const mockForceY = vi.fn();
const mockForceZ = vi.fn();
const mockForceLink = vi.fn();
const mockForceCollide = vi.fn();

vi.mock("d3-force-3d", () => ({
  forceSimulation: vi.fn(),
  forceManyBody: () => mockForceManyBody,
  forceX: () => mockForceX,
  forceY: () => mockForceY,
  forceZ: () => mockForceZ,
  forceLink: () => mockForceLink,
  forceCollide: () => mockForceCollide,
  forceCenter: vi.fn(),
  forceRadial: vi.fn(),
}));

// Mock distributeNodesOnSphere utility
const mockDistributeNodesOnSphere = vi.fn();
vi.mock("@/stores/useSimulationStore/utils/distributeNodesOnSphere", () => ({
  distributeNodesOnSphere: (...args: any[]) => mockDistributeNodesOnSphere(...args),
}));

// Mock useGraphStore
const mockUseGraphStore = {
  getState: vi.fn(),
};
vi.mock("@/stores/useGraphStore", () => ({
  useGraphStore: mockUseGraphStore,
}));

// Mock useDataStore
vi.mock("@/stores/useDataStore", () => ({
  useDataStore: {
    getState: vi.fn(() => ({
      dataInitial: null,
      dataNew: null,
    })),
  },
}));

// Test data factories
const TestDataFactories = {
  node(overrides: Partial<NodeExtended> = {}): NodeExtended {
    return {
      ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
      node_type: "Component",
      name: "TestNode",
      scale: 1,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      z: Math.random() * 1000,
      fx: undefined,
      fy: undefined,
      fz: undefined,
      vx: 0,
      vy: 0,
      vz: 0,
      ...overrides,
    } as NodeExtended;
  },

  nodes(count: number, overrides: Partial<NodeExtended>[] = []): NodeExtended[] {
    return Array.from({ length: count }, (_, i) => 
      this.node({
        ref_id: `node-${i + 1}`,
        name: `Node ${i + 1}`,
        neighbourHood: `neighborhood-${(i % 3) + 1}`,
        scale: 1 + (i % 3) * 0.5,
        ...((overrides[i] as Record<string, unknown> | undefined) || {}),
      })
    );
  },

  link(source: string, target: string, overrides: Partial<Link> = {}): Link<string> {
    return {
      source,
      target,
      ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
      edge_type: "depends_on",
      ...overrides,
    };
  },

  neighborhood(overrides = {}) {
    return {
      ref_id: `neighborhood-${Math.random().toString(36).substr(2, 9)}`,
      label: "Test Neighborhood",
      ...overrides,
    };
  },

  neighborhoods(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      ref_id: `neighborhood-${i + 1}`,
      label: `Neighborhood ${i + 1}`,
    }));
  },

  neighborhoodCenters(neighborhoods: any[]) {
    return neighborhoods.reduce((acc, neighborhood, i) => {
      const angle = (i / neighborhoods.length) * 2 * Math.PI;
      acc[neighborhood.ref_id] = {
        x: 3000 * Math.cos(angle),
        y: 3000 * Math.sin(angle),
        z: 0,
      };
      return acc;
    }, {} as Record<string, { x: number; y: number; z: number }>);
  },

  mockSimulation() {
    const mockNodes: NodeExtended[] = [];
    const mockLinks: Link<NodeExtended>[] = [];
    const mockForces = new Map<string, any>();

    const mockSimulation: any = {
      nodes: vi.fn(),
      force: vi.fn((name: string, forceConfig?: any) => {
        if (forceConfig !== undefined) {
          mockForces.set(name, forceConfig);
          return mockSimulation;
        }
        return mockForces.get(name) || { links: () => mockLinks };
      }),
      alpha: vi.fn(() => 1),
      alphaTarget: vi.fn(() => mockSimulation),
      restart: vi.fn(() => mockSimulation),
      stop: vi.fn(() => mockSimulation),
      on: vi.fn(() => mockSimulation),
    };

    // Set up nodes function implementation
    mockSimulation.nodes.mockImplementation((newNodes?: NodeExtended[]) => {
      if (newNodes !== undefined) {
        mockNodes.splice(0, mockNodes.length, ...newNodes);
        return mockSimulation;
      }
      return mockNodes;
    });

    return mockSimulation;
  },
};

describe("useSimulationStore - addClusterForce", () => {
  let mockSimulation: ReturnType<typeof TestDataFactories.mockSimulation>;
  let useSimulationStore: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations  - create a fresh simulation mock for each test
    mockSimulation = TestDataFactories.mockSimulation();

    // Setup force method mocks with chainable API
    mockForceManyBody.strength = vi.fn(() => mockForceManyBody);
    mockForceX.strength = vi.fn(() => mockForceX);
    mockForceY.strength = vi.fn(() => mockForceY);
    mockForceZ.strength = vi.fn(() => mockForceZ);
    mockForceLink.links = vi.fn(() => mockForceLink);
    mockForceLink.strength = vi.fn(() => mockForceLink);
    mockForceLink.distance = vi.fn(() => mockForceLink);
    mockForceLink.id = vi.fn(() => mockForceLink);
    mockForceCollide.radius = vi.fn(() => mockForceCollide);
    mockForceCollide.strength = vi.fn(() => mockForceCollide);
    mockForceCollide.iterations = vi.fn(() => mockForceCollide);

    // Setup default mock return values
    mockDistributeNodesOnSphere.mockReturnValue({});
    mockUseGraphStore.getState.mockReturnValue({
      neighbourhoods: [],
      graphStyle: "force",
    });

    // Import the store after mocks are set up
    const module = await import("@/stores/useSimulationStore");
    useSimulationStore = module.useSimulationStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Neighborhood Center Distribution", () => {
    test("should call distributeNodesOnSphere with neighborhoods and radius 3000", () => {
      const neighborhoods = TestDataFactories.neighborhoods(3);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(5);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockDistributeNodesOnSphere).toHaveBeenCalledWith(neighborhoods, 3000);
      expect(mockDistributeNodesOnSphere).toHaveBeenCalledTimes(1);
    });

    test("should handle empty neighborhoods array", () => {
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: [] });
      mockDistributeNodesOnSphere.mockReturnValue({});

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled();
    });

    test("should handle null neighborhoods", () => {
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: null });

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled();
    });

    test("should handle undefined neighborhoods", () => {
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: undefined });

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled();
    });

    test("should distribute multiple neighborhoods uniformly", () => {
      const neighborhoods = TestDataFactories.neighborhoods(10);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });

      const centers = TestDataFactories.neighborhoodCenters(neighborhoods);
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(50);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockDistributeNodesOnSphere).toHaveBeenCalledWith(neighborhoods, 3000);
      
      // Verify centers are used in force configuration
      expect(mockForceX).toHaveBeenCalled();
      expect(mockForceY).toHaveBeenCalled();
      expect(mockForceZ).toHaveBeenCalled();
    });
  });

  describe("Node Position Reset", () => {
    test("should reset all node position properties to null", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3, [
        { x: 100, y: 200, z: 300, fx: 50, fy: 75, fz: 125, vx: 10, vy: 20, vz: 30 },
        { x: 400, y: 500, z: 600, fx: 150, fy: 175, fz: 225, vx: 40, vy: 50, vz: 60 },
        { x: 700, y: 800, z: 900, fx: 250, fy: 275, fz: 325, vx: 70, vy: 80, vz: 90 },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      // Verify simulation.nodes() was called with reset positions
      expect(mockSimulation.nodes).toHaveBeenCalled();
      const resetNodes = mockSimulation.nodes.mock.calls[0][0];
      
      resetNodes.forEach((node: NodeExtended) => {
        expect(node.fx).toBeNull();
        expect(node.fy).toBeNull();
        expect(node.fz).toBeNull();
        expect(node.x).toBeNull();
        expect(node.y).toBeNull();
        expect(node.z).toBeNull();
        expect(node.vx).toBeNull();
        expect(node.vy).toBeNull();
        expect(node.vz).toBeNull();
      });
    });

    test("should preserve non-position node properties during reset", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(2, [
        { ref_id: "node-1", name: "Component A", scale: 1.5, neighbourHood: "neighborhood-1" },
        { ref_id: "node-2", name: "Component B", scale: 2.0, neighbourHood: "neighborhood-1" },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const resetNodes = mockSimulation.nodes.mock.calls[0][0];
      
      expect(resetNodes[0].ref_id).toBe("node-1");
      expect(resetNodes[0].name).toBe("Component A");
      expect(resetNodes[0].scale).toBe(1.5);
      expect(resetNodes[0].neighbourHood).toBe("neighborhood-1");

      expect(resetNodes[1].ref_id).toBe("node-2");
      expect(resetNodes[1].name).toBe("Component B");
      expect(resetNodes[1].scale).toBe(2.0);
      expect(resetNodes[1].neighbourHood).toBe("neighborhood-1");
    });

    test("should handle nodes with missing position properties", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = [
        { ref_id: "node-1", name: "Node 1" },
        { ref_id: "node-2", name: "Node 2", x: 100 },
        { ref_id: "node-3", name: "Node 3", fx: 50, fy: 75 },
      ] as NodeExtended[];
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      // Should not throw error
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
    });
  });

  describe("Charge Force Configuration", () => {
    test("should configure charge force with strength 0", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(5);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockSimulation.force).toHaveBeenCalledWith("charge", mockForceManyBody);
      expect(mockForceManyBody.strength).toHaveBeenCalled();

      // Verify strength calculation returns 0 for any node
      const strengthFn = mockForceManyBody.strength.mock.calls[0][0];
      const testNode = TestDataFactories.node({ scale: 1 });
      expect(strengthFn(testNode)).toBe(0);
    });

    test("should calculate charge strength as scale * 0 for all nodes", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const strengthFn = mockForceManyBody.strength.mock.calls[0][0];

      // Test various scales
      expect(strengthFn({ scale: 1 })).toBe(0);
      expect(strengthFn({ scale: 2 })).toBe(0);
      expect(strengthFn({ scale: 0.5 })).toBe(0);
      expect(strengthFn({ scale: 10 })).toBe(0);
    });

    test("should handle nodes without scale property", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = [{ ref_id: "node-1", name: "Node without scale" }] as NodeExtended[];
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const strengthFn = mockForceManyBody.strength.mock.calls[0][0];
      
      // Should default to scale 1 if missing
      expect(strengthFn({ scale: undefined })).toBe(0);
      expect(strengthFn({})).toBe(0);
    });
  });

  describe("ForceX/Y/Z Configuration", () => {
    test("should configure forceX with strength 0.1", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = TestDataFactories.neighborhoodCenters(neighborhoods);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockSimulation.force).toHaveBeenCalledWith("x", mockForceX);
      expect(mockForceX.strength).toHaveBeenCalledWith(0.1);
    });

    test("should configure forceY with strength 0.1", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = TestDataFactories.neighborhoodCenters(neighborhoods);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockSimulation.force).toHaveBeenCalledWith("y", mockForceY);
      expect(mockForceY.strength).toHaveBeenCalledWith(0.1);
    });

    test("should configure forceZ with strength 0.1", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = TestDataFactories.neighborhoodCenters(neighborhoods);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockSimulation.force).toHaveBeenCalledWith("z", mockForceZ);
      expect(mockForceZ.strength).toHaveBeenCalledWith(0.1);
    });

    test("should target nodes toward their neighborhood center X coordinate", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = {
        "neighborhood-1": { x: 1000, y: 2000, z: 3000 },
        "neighborhood-2": { x: -1000, y: -2000, z: -3000 },
      };
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(2, [
        { neighbourHood: "neighborhood-1" },
        { neighbourHood: "neighborhood-2" },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const forceXFn = mockSimulation.force.mock.calls.find((call) => call[0] === "x")?.[1];
      expect(forceXFn).toBeDefined();

      // Extract the target function passed to forceX
      const targetFn = mockSimulation.force.mock.calls[1][1]; // forceX is the second force call

      // Test targeting
      expect(targetFn(nodes[0])).toBe(1000);
      expect(targetFn(nodes[1])).toBe(-1000);
    });

    test("should target nodes toward their neighborhood center Y coordinate", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = {
        "neighborhood-1": { x: 1000, y: 2000, z: 3000 },
        "neighborhood-2": { x: -1000, y: -2000, z: -3000 },
      };
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(2, [
        { neighbourHood: "neighborhood-1" },
        { neighbourHood: "neighborhood-2" },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const targetFn = mockSimulation.force.mock.calls[2][1]; // forceY is the third force call

      expect(targetFn(nodes[0])).toBe(2000);
      expect(targetFn(nodes[1])).toBe(-2000);
    });

    test("should target nodes toward their neighborhood center Z coordinate", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      const centers = {
        "neighborhood-1": { x: 1000, y: 2000, z: 3000 },
        "neighborhood-2": { x: -1000, y: -2000, z: -3000 },
      };
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = TestDataFactories.nodes(2, [
        { neighbourHood: "neighborhood-1" },
        { neighbourHood: "neighborhood-2" },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const targetFn = mockSimulation.force.mock.calls[3][1]; // forceZ is the fourth force call

      expect(targetFn(nodes[0])).toBe(3000);
      expect(targetFn(nodes[1])).toBe(-3000);
    });

    test("should default to origin (0,0,0) for nodes without neighborhood assignment", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      const centers = { "neighborhood-1": { x: 1000, y: 2000, z: 3000 } };
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(centers);

      const nodes = [
        TestDataFactories.node({ neighbourHood: "neighborhood-1" }),
        TestDataFactories.node({ neighbourHood: undefined }),
        TestDataFactories.node({ neighbourHood: "non-existent" }),
      ];
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const forceXFn = mockSimulation.force.mock.calls[1][1];
      const forceYFn = mockSimulation.force.mock.calls[2][1];
      const forceZFn = mockSimulation.force.mock.calls[3][1];

      // Node with valid neighborhood
      expect(forceXFn(nodes[0])).toBe(1000);
      expect(forceYFn(nodes[0])).toBe(2000);
      expect(forceZFn(nodes[0])).toBe(3000);

      // Node without neighborhood
      expect(forceXFn(nodes[1])).toBe(0);
      expect(forceYFn(nodes[1])).toBe(0);
      expect(forceZFn(nodes[1])).toBe(0);

      // Node with non-existent neighborhood
      expect(forceXFn(nodes[2])).toBe(0);
      expect(forceYFn(nodes[2])).toBe(0);
      expect(forceZFn(nodes[2])).toBe(0);
    });
  });

  describe("Link Force Configuration", () => {
    test("should configure link force with strength 0", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      const links = [
        TestDataFactories.link("node-1", "node-2"),
        TestDataFactories.link("node-2", "node-3"),
      ];
      
      mockSimulation.nodes.mockReturnValue(nodes);
      mockSimulation.force.mockImplementation((name: string) => {
        if (name === "link") {
          return { links: () => links };
        }
        return { links: () => [] };
      });

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceLink.strength).toHaveBeenCalledWith(0);
    });

    test("should configure link force with distance 400", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(2);
      const links = [TestDataFactories.link("node-1", "node-2")];
      
      mockSimulation.nodes.mockReturnValue(nodes);
      mockSimulation.force.mockImplementation((name: string) => {
        if (name === "link") {
          return { links: () => links };
        }
        return { links: () => [] };
      });

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceLink.distance).toHaveBeenCalledWith(400);
    });

    test("should configure link force to use node ref_id as identifier", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(2);
      const links = [TestDataFactories.link("node-1", "node-2")];
      
      mockSimulation.nodes.mockReturnValue(nodes);
      mockSimulation.force.mockImplementation((name: string) => {
        if (name === "link") {
          return { links: () => links };
        }
        return { links: () => [] };
      });

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceLink.id).toHaveBeenCalled();
      
      // Verify id function extracts ref_id
      const idFn = mockForceLink.id.mock.calls[0][0];
      expect(idFn({ ref_id: "test-node-123" })).toBe("test-node-123");
    });

    test("should map link source and target to ref_id strings", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      const links = [
        { source: { ref_id: "node-1" }, target: { ref_id: "node-2" }, ref_id: "link-1" },
        { source: { ref_id: "node-2" }, target: { ref_id: "node-3" }, ref_id: "link-2" },
      ] as any[];
      
      mockSimulation.nodes.mockReturnValue(nodes);
      mockSimulation.force.mockImplementation((name: string) => {
        if (name === "link") {
          return { links: () => links };
        }
        return { links: () => [] };
      });

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceLink.links).toHaveBeenCalled();
      
      const mappedLinks = mockForceLink.links.mock.calls[0][0];
      expect(mappedLinks[0].source).toBe("node-1");
      expect(mappedLinks[0].target).toBe("node-2");
      expect(mappedLinks[1].source).toBe("node-2");
      expect(mappedLinks[1].target).toBe("node-3");
    });

    test("should handle empty links array", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      
      mockSimulation.nodes.mockReturnValue(nodes);
      mockSimulation.force.mockImplementation((name: string) => {
        if (name === "link") {
          return { links: () => [] };
        }
        return { links: () => [] };
      });

      useSimulationStore.setState({ simulation: mockSimulation });
      
      // Should not throw error
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
    });
  });

  describe("Collision Force Configuration", () => {
    test("should configure collision radius as 95 * scale", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3, [
        { scale: 1 },
        { scale: 2 },
        { scale: 0.5 },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceCollide.radius).toHaveBeenCalled();
      
      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      expect(radiusFn(nodes[0])).toBe(95);
      expect(radiusFn(nodes[1])).toBe(190);
      expect(radiusFn(nodes[2])).toBe(47.5);
    });

    test("should configure collision strength as 0.5", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceCollide.strength).toHaveBeenCalledWith(0.5);
    });

    test("should configure collision iterations as 1", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      expect(mockForceCollide.iterations).toHaveBeenCalledWith(1);
    });

    test("should default to scale 1 for nodes without scale property", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = [
        { ref_id: "node-1", name: "Node without scale" },
        { ref_id: "node-2", name: "Node with scale", scale: 2 },
      ] as NodeExtended[];
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      
      // Should default to scale 1
      expect(radiusFn({ scale: undefined })).toBe(95);
      expect(radiusFn({ scale: null })).toBe(95);
      expect(radiusFn({})).toBe(95);
      
      // Should use provided scale
      expect(radiusFn({ scale: 2 })).toBe(190);
    });

    test("should handle large scale values correctly", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(2, [
        { scale: 10 },
        { scale: 100 },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      
      expect(radiusFn(nodes[0])).toBe(950);
      expect(radiusFn(nodes[1])).toBe(9500);
    });

    test("should handle fractional scale values correctly", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3, [
        { scale: 0.1 },
        { scale: 0.25 },
        { scale: 0.75 },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      
      expect(radiusFn(nodes[0])).toBe(9.5);
      expect(radiusFn(nodes[1])).toBe(23.75);
      expect(radiusFn(nodes[2])).toBe(71.25);
    });
  });

  describe("Edge Cases", () => {
    test("should handle single node", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(1);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
      expect(mockSimulation.nodes).toHaveBeenCalled();
    });

    test("should handle large number of nodes", () => {
      const neighborhoods = TestDataFactories.neighborhoods(5);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(1000);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
      expect(mockSimulation.nodes).toHaveBeenCalled();
    });

    test("should handle nodes with zero scale", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(2, [
        { scale: 0 },
        { scale: 1 },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      
      // 0 * 95 = 0, but this should still work
      expect(radiusFn(nodes[0])).toBe(0);
      expect(radiusFn(nodes[1])).toBe(95);
    });

    test("should handle negative scale values", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(1, [{ scale: -1 }]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      const radiusFn = mockForceCollide.radius.mock.calls[0][0];
      
      // Should handle negative scale (even if unusual)
      expect(radiusFn(nodes[0])).toBe(-95);
    });

    test("should handle nodes with special characters in ref_id", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = [
        TestDataFactories.node({ ref_id: "node-with-dash" }),
        TestDataFactories.node({ ref_id: "node_with_underscore" }),
        TestDataFactories.node({ ref_id: "node.with.dots" }),
        TestDataFactories.node({ ref_id: "node@special#chars" }),
      ];
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
    });

    test("should handle neighborhoods with special characters in ref_id", () => {
      const neighborhoods = [
        { ref_id: "neighborhood-1", label: "Neighborhood 1" },
        { ref_id: "neighborhood_2", label: "Neighborhood 2" },
        { ref_id: "neighborhood.3", label: "Neighborhood 3" },
      ];
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(6, [
        { neighbourHood: "neighborhood-1" },
        { neighbourHood: "neighborhood-1" },
        { neighbourHood: "neighborhood_2" },
        { neighbourHood: "neighborhood_2" },
        { neighbourHood: "neighborhood.3" },
        { neighbourHood: "neighborhood.3" },
      ]);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
    });

    test("should handle very large radius value (3000)", () => {
      const neighborhoods = TestDataFactories.neighborhoods(5);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      
      const largeCenters = neighborhoods.reduce((acc, n, i) => {
        const angle = (i / neighborhoods.length) * 2 * Math.PI;
        acc[n.ref_id] = {
          x: 3000 * Math.cos(angle),
          y: 3000 * Math.sin(angle),
          z: 0,
        };
        return acc;
      }, {} as Record<string, { x: number; y: number; z: number }>);
      
      mockDistributeNodesOnSphere.mockReturnValue(largeCenters);

      const nodes = TestDataFactories.nodes(10);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
      expect(mockDistributeNodesOnSphere).toHaveBeenCalledWith(neighborhoods, 3000);
    });
  });

  describe("Integration", () => {
    test("should call all force configuration methods in correct order", () => {
      const neighborhoods = TestDataFactories.neighborhoods(2);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(5);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      // Verify order: nodes, charge, x, y, z, link, collide
      const forceCalls = mockSimulation.force.mock.calls;
      expect(forceCalls[0][0]).toBe("charge");
      expect(forceCalls[1][0]).toBe("x");
      expect(forceCalls[2][0]).toBe("y");
      expect(forceCalls[3][0]).toBe("z");
      expect(forceCalls[4][0]).toBe("link");
      expect(forceCalls[5][0]).toBe("collide");
    });

    test("should work with simulation.nodes() returning empty array", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      mockSimulation.nodes.mockReturnValue([]);

      useSimulationStore.setState({ simulation: mockSimulation });
      
      expect(() => useSimulationStore.getState().addClusterForce()).not.toThrow();
    });

    test("should maintain chainable API for force configuration", () => {
      const neighborhoods = TestDataFactories.neighborhoods(1);
      mockUseGraphStore.getState.mockReturnValue({ neighbourhoods: neighborhoods });
      mockDistributeNodesOnSphere.mockReturnValue(
        TestDataFactories.neighborhoodCenters(neighborhoods)
      );

      const nodes = TestDataFactories.nodes(3);
      mockSimulation.nodes.mockReturnValue(nodes);

      useSimulationStore.setState({ simulation: mockSimulation });
      useSimulationStore.getState().addClusterForce();

      // Verify each force returns itself for chaining
      expect(mockSimulation.force).toHaveReturnedWith(mockSimulation);
    });
  });
});