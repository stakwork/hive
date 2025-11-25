import { Node, NodeExtended } from '@Universe/types';
import {
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
      const { simulation, resetSimulation, addLinkForce, addSplitForce } = get();
      const { graphStyle } = graphStore.getState();

      if (!simulation) return;

      // 1. Clean Slate (Remove conflicting forces & unlock grid nodes)
      resetSimulation();

      // 2. Apply Style
      switch (graphStyle) {
        case 'sphere': // Organic / Connected Subgraphs
          addLinkForce();
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

    addLinkForce: () => {
      const { simulation } = get();
      if (!simulation) return;

      const nodes = simulation.nodes() as NodeExtended[];

      // 1. Extract Feature nodes
      const featureNodes = nodes.filter((n) => n.node_type === 'Feature');

      // If no features – fall back to a normal layout
      const linkForceExisting = simulation.force('link') as any;
      const links = linkForceExisting ? linkForceExisting.links() : [];

      if (featureNodes.length === 0) {
        simulation
          .force('charge', forceManyBody().strength(-600))
          .force('x', forceX().strength(0.1))
          .force('y', forceY().strength(0.1))
          .force('z', forceZ().strength(0.1))
          .force(
            'link',
            forceLink(links)
              .id((d: any) => d.ref_id)
              .distance(80)
              .strength(0.8)
          )
          .force(
            'collide',
            forceCollide().radius((d: NodeExtended) => (d.scale || 1) * 30).strength(0.8)
          );
        return;
      }

      // 2. Distribute Feature nodes on a sphere
      // distributeNodesOnSphere returns: { [ref_id]: { x, y, z } }
      const centers = distributeNodesOnSphere(
        featureNodes.map((n) => ({ ref_id: n.ref_id })),
        4000 // radius
      ) as Record<string, { x: number; y: number; z: number }>;

      // 3. Build adjacency: node -> Set<featureRefId>
      const featureAdj = new Map<string, Set<string>>();

      for (const l of links) {
        const sourceNode =
          typeof l.source === 'object'
            ? (l.source as NodeExtended)
            : (nodes.find((n) => n.ref_id === l.source) as NodeExtended | undefined);
        const targetNode =
          typeof l.target === 'object'
            ? (l.target as NodeExtended)
            : (nodes.find((n) => n.ref_id === l.target) as NodeExtended | undefined);

        if (!sourceNode || !targetNode) continue;

        // If source is Feature, target gets attracted to it
        if (sourceNode.node_type === 'Feature') {
          if (!featureAdj.has(targetNode.ref_id)) featureAdj.set(targetNode.ref_id, new Set());
          featureAdj.get(targetNode.ref_id)!.add(sourceNode.ref_id);
        }

        // If target is Feature, source gets attracted to it
        if (targetNode.node_type === 'Feature') {
          if (!featureAdj.has(sourceNode.ref_id)) featureAdj.set(sourceNode.ref_id, new Set());
          featureAdj.get(sourceNode.ref_id)!.add(targetNode.ref_id);
        }
      }

      // 4. Feature nodes: pulled to their sphere centers
      simulation
        .force(
          'featureX',
          forceX((n: any) => {
            if (n.node_type !== 'Feature') return 0;
            const c = centers[n.ref_id];
            return c ? c.x : 0;
          }).strength(0.5)
        )
        .force(
          'featureY',
          forceY((n: any) => {
            if (n.node_type !== 'Feature') return 0;
            const c = centers[n.ref_id];
            return c ? c.y : 0;
          }).strength(0.5)
        )
        .force(
          'featureZ',
          forceZ((n: any) => {
            if (n.node_type !== 'Feature') return 0;
            const c = centers[n.ref_id];
            return c ? c.z : 0;
          }).strength(0.5)
        );

      // 5. Non-feature nodes: attracted to ALL related features (multi-cluster)
      simulation
        .force(
          'clusterX',
          forceX((n: any) => {
            if (n.node_type === 'Feature') return 0;
            const features = featureAdj.get(n.ref_id);
            if (!features || features.size === 0) return 0;

            let x = 0;
            let count = 0;
            for (const fId of features) {
              const c = centers[fId];
              if (!c) continue;
              x += c.x;
              count++;
            }
            if (!count) return 0;
            return x / count;
          }).strength(0.2)
        )
        .force(
          'clusterY',
          forceY((n: any) => {
            if (n.node_type === 'Feature') return 0;
            const features = featureAdj.get(n.ref_id);
            if (!features || features.size === 0) return 0;

            let y = 0;
            let count = 0;
            for (const fId of features) {
              const c = centers[fId];
              if (!c) continue;
              y += c.y;
              count++;
            }
            if (!count) return 0;
            return y / count;
          }).strength(0.2)
        )
        .force(
          'clusterZ',
          forceZ((n: any) => {
            if (n.node_type === 'Feature') return 0;
            const features = featureAdj.get(n.ref_id);
            if (!features || features.size === 0) return 0;

            let z = 0;
            let count = 0;
            for (const fId of features) {
              const c = centers[fId];
              if (!c) continue;
              z += c.z;
              count++;
            }
            if (!count) return 0;
            return z / count;
          }).strength(0.2)
        );

      // 6. Base physics
      simulation
        .force('charge', forceManyBody().strength(-200))
        .force(
          'collide',
          forceCollide().radius((d: any) => (d.scale || 1) * 40)
        )
        .force(
          'link',
          forceLink(links)
            .id((d: any) => d.ref_id)
            .distance(120)
            .strength(0.3)
        );
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
