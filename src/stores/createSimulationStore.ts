import { nodeSize } from '@Universe/Graph/Cubes/constants';
import { Node, NodeExtended } from '@Universe/types';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ
} from 'd3-force-3d';
import { create } from "zustand";
import { createDataStore } from "./createDataStore";
import { type SimulationStore } from "./useSimulationStore";
import { distributeNodesOnSphere } from './useSimulationStore/utils/distributeNodesOnSphere';


// --- HELPER: Pure Grid Logic ---
// Calculates target positions but does NOT modify the simulation directly.
export const calculateGridMap = (nodes: Node[], nodeTypes: string[]) => {
  const nodesByType: Record<string, Node[]> = {};

  // 1. Group by type
  nodes.forEach((node) => {
    if (!nodesByType[node.node_type]) nodesByType[node.node_type] = [];
    nodesByType[node.node_type].push(node);
  });

  const positionMap = new Map<string, { x: number, y: number, z: number }>();

  // 2. Calculate positions for each type
  nodes.forEach((n) => {
    const typeIndex = nodeTypes.indexOf(n.node_type) + 1;
    // Separate layers by 500 units on Y axis
    const yLayer = Math.floor(typeIndex / 2) * 500;
    const isEvenLayer = typeIndex % 2 === 0;
    const yOffset = isEvenLayer ? yLayer : -yLayer;

    const sameTypeNodes = nodesByType[n.node_type];
    const nodeIndexInType = sameTypeNodes.findIndex(node => node.ref_id === n.ref_id);

    const nodesPerRow = Math.ceil(Math.sqrt(sameTypeNodes.length));
    const spacing = 300;

    const row = Math.floor(nodeIndexInType / nodesPerRow);
    const col = nodeIndexInType % nodesPerRow;

    const gridWidth = (nodesPerRow - 1) * spacing;
    const gridHeight = (Math.ceil(sameTypeNodes.length / nodesPerRow) - 1) * spacing;

    const x = col * spacing - gridWidth / 2;
    const z = row * spacing - gridHeight / 2;

    positionMap.set(n.ref_id, { x, y: yOffset, z });
  });

  // 3. Center the entire grid around (0,0,0)
  const positions = Array.from(positionMap.values());
  if (positions.length > 0) {
    // Calculate bounds
    const minX = Math.min(...positions.map(p => p.x));
    const maxX = Math.max(...positions.map(p => p.x));
    const minZ = Math.min(...positions.map(p => p.z));
    const maxZ = Math.max(...positions.map(p => p.z));

    // Calculate center offset
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Apply center offset to all positions
    for (const [nodeId, pos] of positionMap.entries()) {
      positionMap.set(nodeId, {
        x: pos.x - centerX,
        y: pos.y, // Y is already centered around 0 with positive/negative layers
        z: pos.z - centerZ
      });
    }
  }

  return positionMap;
};

export const createSimulationStore = (
  dataStore: ReturnType<typeof createDataStore>,
  graphStore: any
) =>
  create<SimulationStore>((set, get) => ({
    simulation: null,
    simulationVersion: 0,
    simulationInProgress: false,
    isSleeping: false,

    simulationCreate: (nodes) => {
      // Initialize with nodes but stop immediately.
      // setForces() will handle the wakeup.
      const simulation = forceSimulation(structuredClone(nodes))
        .numDimensions(3)
        .stop();

      set({ simulation });
    },

    removeSimulation: () => {
      get().simulation?.stop();
      set({ simulation: null });
    },

    // --- CORE: DATA INGESTION ---
    addNodesAndLinks: (newNodes, newLinks, replace) => {
      const { simulation, setForces } = get();
      if (!simulation) return;

      simulation.stop();

      // 1. Safely retrieve current data
      const linkForce = simulation.force('link');
      const currentNodes = replace ? [] : simulation.nodes();
      // Defensive check: if force is missing (e.g. from previous bugs), start empty
      const currentLinks = (replace || !linkForce) ? [] : linkForce.links();

      // 2. Merge Data
      const nextNodes = [...currentNodes, ...structuredClone(newNodes)];
      const nextLinks = [...currentLinks, ...structuredClone(newLinks)];

      // 3. Filter Valid Links (Source/Target must exist)
      const validLinks = nextLinks.filter(l => {
        const sourceId = typeof l.source === 'object' ? l.source.ref_id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.ref_id : l.target;
        return nextNodes.some(n => n.ref_id === sourceId) &&
          nextNodes.some(n => n.ref_id === targetId);
      });

      // 4. Update D3 Data
      simulation.nodes(nextNodes);

      // Re-initialize link force to register new connections
      simulation.force('link', forceLink(validLinks).id((d: Node) => d.ref_id));

      // 5. Trigger Layout Calculation
      // This ensures new nodes snap to grid (if Split) or start physics (if Organic)
      setForces();
    },

    // --- CORE: LAYOUT MANAGER ---
    setForces: () => {
      const { simulation, resetSimulation, addLinkForce, addClusterForce, addSplitForce } = get();
      const { graphStyle } = graphStore.getState();

      if (!simulation) return;

      // 1. Clean Slate (Remove conflicting forces & unlock grid nodes)
      resetSimulation();

      // 2. Apply Style
      switch (graphStyle) {
        case 'sphere': // Organic / Connected Subgraphs
          addLinkForce();
          break;
        case 'force':
          addClusterForce();
          break;
        case 'split':
          addSplitForce();
          break;
        default:
          addLinkForce();
          break;
      }

      const alpha = graphStyle === 'split' ? 0.01 : 1;

      // 3. HIGH ENERGY RESTART
      // Use alpha(1) to violently break the grid shape when switching modes
      simulation.alpha(alpha).restart();
    },

    // Helper to clear pollution from previous modes
    resetSimulation: () => {
      const { simulation } = get();
      if (!simulation) return;

      // Remove specific layout forces
      simulation.force('radial', null);
      simulation.force('x', null);
      simulation.force('y', null);
      simulation.force('z', null);
      simulation.force('center', null);
      simulation.force('collide', null);

      // UNLOCK NODES: Crucial for switching from Split -> Organic
      // We must set fx/fy/fz to null so physics can move them again.
      simulation.nodes().forEach((n: NodeExtended) => {
        n.fx = undefined;
        n.fy = undefined;
        n.fz = undefined;
      });
    },

    // --- STYLE 1: ORGANIC (Connected Subgraphs) ---
    addLinkForce: () => {
      const { simulation } = get();

      // Defensive link check
      const linkForce = simulation.force('link');
      const currentLinks = linkForce ? linkForce.links() : [];

      simulation
        // Strong center force pulls the wide "Grid" shape back into a blob
        .force('center', forceCenter().strength(0.1))

        // Strong negative charge pushes nodes apart to create clarity
        .force(
          'charge',
          forceManyBody()
            .strength((_d: NodeExtended) => -4)
        )

        // Longer links to create space between connected nodes
        .force(
          'link',
          forceLink()
            .links(currentLinks)
            .id((d: Node) => d.ref_id)
            .distance(10)
            .strength(1)
        )

        // Large collision radius to prevent tight bunching
        .force(
          'collide',
          forceCollide()
            .radius((d: NodeExtended) => (d.scale || 1) * nodeSize * 4)
            .strength(0.7)
        )
      // .force('radial', forceRadial(900, 0, 0, 0).strength(0.1))
    },

    // --- STYLE 2: CLUSTER FORCE (Data Grouping) ---
    addClusterForce: () => {
      const { simulation } = get();
      const { neighbourhoods } = graphStore.getState();

      // Defensive link check
      const linkForce = simulation.force('link');
      const currentLinks = linkForce ? linkForce.links() : [];

      const centers = neighbourhoods?.length ? distributeNodesOnSphere(neighbourhoods, 3000) : {};

      simulation
        .force('center', forceCenter().strength(0.01))
        .force('charge', forceManyBody().strength(-30))
        .force(
          'x',
          forceX((n: NodeExtended) => {
            const c = centers[n.neighbourHood || ''];
            return c ? c.x : 0;
          }).strength(0.3)
        )
        .force(
          'y',
          forceY((n: NodeExtended) => {
            const c = centers[n.neighbourHood || ''];
            return c ? c.y : 0;
          }).strength(0.3)
        )
        .force(
          'z',
          forceZ((n: NodeExtended) => {
            const c = centers[n.neighbourHood || ''];
            return c ? c.z : 0;
          }).strength(0.3)
        )
        // Weak links allow nodes to travel to their clusters
        .force(
          'link',
          forceLink()
            .links(currentLinks)
            .id((d: Node) => d.ref_id)
            .strength(0.01)
        )
        .force('collide', forceCollide().radius(50).strength(0.5));
    },

    // --- STYLE 3: SPLIT / GRID (Deterministic) ---
    addSplitForce: () => {
      const { simulation } = get();
      const { nodeTypes } = dataStore.getState();
      const nodes = simulation.nodes();

      // 1. Calculate Grid Positions (includes new nodes)
      const gridMap = calculateGridMap(nodes, nodeTypes);

      // 2. Lock Positions
      nodes.forEach((n: NodeExtended) => {
        const pos = gridMap.get(n.ref_id);
        if (pos) {
          n.fx = pos.x;
          n.fy = pos.y;
          n.fz = pos.z;
        }
      });

      // 3. Disable Physics Forces
      simulation
        .force('charge', null)
        .force('center', null)
        .force('collide', null);

      // MUTE links, do not remove the force (to preserve data)
      const linkForce = simulation.force('link');
      if (linkForce) {
        linkForce.strength(0);
      }

      // Use minimal alpha since positions are deterministic/linear
      simulation.alpha(0.01);
    },

    // --- GETTERS / SETTERS ---

    getLinks: () => {
      const { simulation } = get();
      if (!simulation) return [];

      // Defensive check to prevent "undefined" error
      const linkForce = simulation.force('link');
      return linkForce ? linkForce.links() : [];
    },

    simulationRestart: () => {
      const { simulation, setSimulationInProgress } = get();

      if (!simulation) {
        return;
      }

      setSimulationInProgress(true);
      simulation.alpha(0.4).restart();
    },

    updateSimulationVersion: () => {
      set((state) => ({ simulationVersion: state.simulationVersion + 1 }));
    },

    setSimulationInProgress: (simulationInProgress: boolean) => {
      set({ simulationInProgress });
    },

    setIsSleeping: (isSleeping: boolean) => {
      set({ isSleeping });
    },

  }));
