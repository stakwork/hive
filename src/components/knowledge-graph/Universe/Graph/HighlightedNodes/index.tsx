import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore, useGraphStore, useSimulationStore } from "@/stores/useStores";
import { NodeExtended } from "@Universe/types";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import { Group, Mesh, MeshBasicMaterial } from "three";

const HIGHLIGHT_DURATION = 15000; // 15 seconds
const PULSE_SPEED = 3;
const BASE_SCALE = 0.8;
const PULSE_AMPLITUDE = 0.1;

// const MOCK_NODES = ["768a7859-5c49-4675-91b2-fc48dcd0b039"]

// NEURON_PULSE highlight configuration
const NEURON_PULSE = {
  color: "#00ff88", // Electric green
  pulseSpeed: PULSE_SPEED,
  amplitude: PULSE_AMPLITUDE,
};

export const HighlightedNodesLayer = memo(() => {
  const groupRef = useRef<Group>(null);
  const timeRef = useRef(0);

  const { workspace } = useWorkspace();
  const {
    webhookHighlightNodes,
    highlightTimestamp,
    webhookHighlightDepth,
    clearWebhookHighlights,
    setWebhookHighlightNodes,
  } = useGraphStore((s) => s);
  const { simulation } = useSimulationStore((s) => s);
  const nodesNormalized = useDataStore((s) => s.nodesNormalized);
  const addNewNode = useDataStore((s) => s.addNewNode);

  // Auto-clear highlights after duration
  useEffect(() => {
    const shouldClear = highlightTimestamp && Date.now() - highlightTimestamp > HIGHLIGHT_DURATION;
    if (shouldClear && webhookHighlightNodes.length > 0) {
      clearWebhookHighlights();
    }
  }, [highlightTimestamp, webhookHighlightNodes, clearWebhookHighlights]);

  // Memoize node IDs to prevent unnecessary re-renders
  const nodeIdsToHighlight = useMemo(() => webhookHighlightNodes || [], [webhookHighlightNodes]);
  const simulationNodes = simulation?.nodes() || [];

  useEffect(() => {
    const fetchNodesData = async () => {
      if (!workspace?.slug || webhookHighlightNodes.length === 0) return;

      try {
        if (webhookHighlightDepth === 0) {
          // Depth 0: Just fetch missing nodes directly
          const foundNodeIds = new Set();
          const missingNodeIds: string[] = [];

          webhookHighlightNodes.forEach((nodeId) => {
            const inNormalized = nodesNormalized?.get(nodeId);
            if (inNormalized) {
              foundNodeIds.add(nodeId);
            } else {
              missingNodeIds.push(nodeId);
            }
          });

          if (missingNodeIds.length > 0) {
            const refIds = missingNodeIds.join(",");
            const response = await fetch(`/api/workspaces/${workspace.slug}/graph/nodes?ref_ids=${refIds}`);

            if (!response.ok) {
              console.error("Failed to fetch missing nodes:", response.statusText);
              return;
            }

            const data = await response.json();
            const nodes = data.data || [];

            console.log("missing added nodes:", nodes);

            if (nodes.length > 0) {
              addNewNode({ nodes, edges: [] });
            }
          }
        } else {
          // Depth > 0: Call subgraph endpoint for each ref_id and group results
          console.log(
            `Fetching subgraphs for ${webhookHighlightNodes.length} nodes with depth ${webhookHighlightDepth}`,
          );

          const allNodes: any[] = [];
          const allEdges: any[] = [];
          const allNodeIds = new Set<string>(webhookHighlightNodes); // Start with original nodes

          for (const nodeId of webhookHighlightNodes) {
            try {
              // Build subgraph endpoint URL
              const subgraphEndpoint = `/graph/subgraph?include_properties=true&start_node=${nodeId}&depth=${webhookHighlightDepth}&min_depth=0&limit=100&sort_by=date_added_to_graph`;
              const encodedEndpoint = encodeURIComponent(subgraphEndpoint);

              const response = await fetch(`/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=${encodedEndpoint}`);

              if (!response.ok) {
                console.error(`Failed to fetch subgraph for node ${nodeId}:`, response.statusText);
                continue;
              }

              const data = await response.json();
              const nodes = data.data?.nodes || [];
              const edges = data.data?.edges || [];

              console.log(`Subgraph for node ${nodeId}:`, { nodes: nodes.length, edges: edges.length });

              // Collect all unique nodes and edges
              nodes.forEach((node: any) => {
                if (!allNodeIds.has(node.ref_id)) {
                  allNodeIds.add(node.ref_id);
                  allNodes.push(node);
                }
              });

              edges.forEach((edge: any) => {
                // Check if edge already exists to avoid duplicates
                const edgeExists = allEdges.some(
                  (existingEdge) =>
                    existingEdge.ref_id === edge.ref_id ||
                    (existingEdge.source === edge.source && existingEdge.target === edge.target),
                );
                if (!edgeExists) {
                  allEdges.push(edge);
                }
              });
            } catch (error) {
              console.error(`Error fetching subgraph for node ${nodeId}:`, error);
            }
          }

          // Add all collected nodes and edges to the graph
          if (allNodes.length > 0 || allEdges.length > 0) {
            console.log(`Adding grouped subgraph data:`, { nodes: allNodes.length, edges: allEdges.length });
            addNewNode({ nodes: allNodes, edges: allEdges });

            // Update webhookHighlightNodes to include all fetched node IDs
            const updatedHighlightNodes = Array.from(allNodeIds);
            console.log(
              `Updating webhookHighlightNodes from ${webhookHighlightNodes.length} to ${updatedHighlightNodes.length} nodes`,
            );
            setWebhookHighlightNodes(updatedHighlightNodes, webhookHighlightDepth);
          }
        }
      } catch (error) {
        console.error("Error in fetchNodesData:", error);
      }
    };

    fetchNodesData();
  }, [webhookHighlightNodes, webhookHighlightDepth, nodesNormalized, addNewNode, workspace?.id]);

  const highlightedNodes = nodeIdsToHighlight
    .map((nodeId) => simulationNodes.find((node: NodeExtended) => node.ref_id === nodeId))
    .filter(Boolean) as NodeExtended[];

  useFrame(({ clock }) => {
    if (!groupRef.current || highlightedNodes.length === 0) return;

    timeRef.current = clock.getElapsedTime();

    // Animate each highlighted node
    groupRef.current.children.forEach((child, index) => {
      if (child instanceof Group) {
        const pulseFactor = Math.sin(timeRef.current * NEURON_PULSE.pulseSpeed + index * 0.5) * NEURON_PULSE.amplitude;
        const scale = BASE_SCALE + pulseFactor;
        child.scale.setScalar(scale);

        // Fade out effect as we approach auto-clear
        if (highlightTimestamp) {
          const elapsed = Date.now() - highlightTimestamp;
          const fadeStart = HIGHLIGHT_DURATION * 0.8; // Start fading at 80% of duration
          if (elapsed > fadeStart) {
            const fadeProgress = (elapsed - fadeStart) / (HIGHLIGHT_DURATION - fadeStart);
            const opacity = Math.max(0.1, 1 - fadeProgress);

            child.children.forEach((mesh) => {
              if (mesh instanceof Mesh && mesh.material instanceof MeshBasicMaterial) {
                mesh.material.opacity = opacity;
              }
            });
          }
        }
      }
    });
  });

  if (highlightedNodes.length === 0) return null;

  return (
    <group ref={groupRef} name="highlighted-nodes-layer">
      {highlightedNodes.map((node) => (
        <group key={`highlight-${node.ref_id}`} position={[node.x || 0, node.y || 0, node.z || 0]}>
          {/* Single pulsing sphere */}
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[25, 32, 16]} />
            <meshBasicMaterial color={NEURON_PULSE.color} transparent opacity={0.6} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

HighlightedNodesLayer.displayName = "HighlightedNodesLayer";
