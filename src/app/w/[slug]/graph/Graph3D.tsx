"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as d3 from "d3";

// Camera controller
const CameraController = ({
  distance,
  onUpdate,
}: {
  distance: number;
  onUpdate?: (pos: THREE.Vector3, distance: number) => void;
}) => {
  const { camera } = useThree();

  useEffect(() => {
    // Angled view to better see layer depth
    // Position camera at a steeper angle to see the z-axis layers more clearly
    const angle = Math.PI / 4; // 45 degrees (increased from 30)
    const x = distance * Math.sin(angle);
    const y = distance * 0.4; // More elevated
    const z = distance * Math.cos(angle);

    const newPos = new THREE.Vector3(x, y, z);
    camera.position.copy(newPos);
    camera.lookAt(0, 0, 0);
  }, [camera, distance]);

  useEffect(() => {
    if (!onUpdate) return;
    const interval = setInterval(() => {
      const dist = camera.position.length();
      onUpdate(camera.position, dist);
    }, 100);
    return () => clearInterval(interval);
  }, [camera, onUpdate]);

  return null;
};

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  [key: string]: unknown;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  [key: string]: unknown;
}

interface Graph3DProps {
  nodes: D3Node[];
  links: D3Link[];
  nodeTypes: string[];
  colorPalette: string[];
  isDarkMode?: boolean;
  onNodeClick?: (node: D3Node) => void;
  showCameraControls?: boolean;
  selectedNodeId?: string | null;
}

interface NodeMeshProps {
  node: D3Node;
  color: string;
  onClick: () => void;
  isSelected: boolean;
  isConnected: boolean;
  isDimmed: boolean;
}

// --- HELPERS ---

// Node type priority mapping (higher priority = lower layer number)
// Grouped by semantic level: Structure → Organization → Implementation → Tests
const NODE_TYPE_PRIORITIES: Record<string, number> = {
  // High-level structure (Layer 0 - back)
  Repository: 1,
  Language: 2,
  Package: 3,
  Directory: 4,

  // Organization & documentation (Layer 0/1 - back/middle)
  Prompt: 5,
  Hint: 6,
  Page: 7,
  File: 8,

  // Code structure (Layer 1 - middle)
  Import: 9,
  Class: 10,
  Trait: 11,
  Datamodel: 12,

  // Implementation details (Layer 1/2 - middle/front)
  Function: 13,
  Endpoint: 14,
  Request: 15,
  Var: 16,

  // Tests (Layer 2 - front)
  Unittest: 17,
  E2etest: 18,
  Integrationtest: 19,
};

// Assign nodes to 3 balanced layers based on their type priorities
const assignNodesToLayers = (nodes: D3Node[]): Map<string, number> => {
  // Count nodes by type
  const typeCounts = new Map<string, number>();
  nodes.forEach((node) => {
    typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  });

  // Sort types by priority (highest priority first)
  const sortedTypes = Array.from(typeCounts.keys()).sort((a, b) => {
    const priorityA = NODE_TYPE_PRIORITIES[a] || 999;
    const priorityB = NODE_TYPE_PRIORITIES[b] || 999;
    return priorityA - priorityB;
  });

  const typeToLayer = new Map<string, number>();

  // Special case: only 1 type
  if (sortedTypes.length === 1) {
    typeToLayer.set(sortedTypes[0], 1); // middle layer
  }
  // Special case: only 2 types
  else if (sortedTypes.length === 2) {
    typeToLayer.set(sortedTypes[0], 0); // back layer
    typeToLayer.set(sortedTypes[1], 2); // front layer
  }
  // 3 or more types: ALWAYS create 3 layers
  else {
    // Greedily assign types to layers to balance node counts
    // while respecting priority order
    const layers: string[][] = [[], [], []];
    const layerCounts = [0, 0, 0];

    sortedTypes.forEach((type) => {
      const count = typeCounts.get(type) || 0;

      // Find which layer should get this type
      // Strategy: assign to the layer with fewest nodes, but ensure all layers get at least one type
      let targetLayer = 0;

      // If any layer is empty, prioritize filling it
      if (layers[0].length === 0) {
        targetLayer = 0;
      } else if (layers[1].length === 0) {
        targetLayer = 1;
      } else if (layers[2].length === 0) {
        targetLayer = 2;
      } else {
        // All layers have at least one type, assign to layer with fewest nodes
        // But prefer earlier layers (higher priority) when counts are similar
        const minCount = Math.min(...layerCounts);
        targetLayer = layerCounts.findIndex((c) => c === minCount);
      }

      layers[targetLayer].push(type);
      layerCounts[targetLayer] += count;
      typeToLayer.set(type, targetLayer);
    });
  }

  // Map node IDs to their layer
  const nodeToLayer = new Map<string, number>();
  nodes.forEach((node) => {
    const layer = typeToLayer.get(node.type) ?? 1;
    nodeToLayer.set(node.id, layer);
  });

  return nodeToLayer;
};

const getNodeColor = (type: string, nodeTypes: string[], colorPalette: string[]): string => {
  const index = nodeTypes.indexOf(type);
  if (index !== -1) {
    return colorPalette[index % colorPalette.length];
  }
  return "#6b7280";
};

// --- NODE MESH COMPONENT ---
const NodeMesh = ({ node, color, onClick, isSelected, isConnected, isDimmed }: NodeMeshProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "auto";
  }, [hovered]);

  const scale = isSelected ? 1.1 : isConnected ? 1.05 : 1;
  const opacity = isDimmed ? 0.7 : 1;

  return (
    <group position={[node.x || 0, node.y || 0, node.z || 0]}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        scale={scale}
      >
        <sphereGeometry args={[8, 32, 32]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          emissive={isSelected ? color : undefined}
          emissiveIntensity={isSelected ? 0.5 : 0}
        />
      </mesh>
      <Text
        position={[0, 12, 0]}
        fontSize={4}
        color={isSelected ? "#3b82f6" : "#ffffff"}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.5}
        outlineColor="#000000"
      >
        {node.name.length > 10 ? `${node.name.slice(0, 10)}...` : node.name}
      </Text>
    </group>
  );
};

// --- LINK LINE COMPONENT ---
const LinkLine = ({ link, isDimmed }: { link: D3Link; isDimmed: boolean }) => {
  const source = link.source as D3Node;
  const target = link.target as D3Node;

  const points = useMemo(() => {
    const start = new THREE.Vector3(source.x || 0, source.y || 0, source.z || 0);
    const end = new THREE.Vector3(target.x || 0, target.y || 0, target.z || 0);
    return [start, end];
  }, [source.x, source.y, source.z, target.x, target.y, target.z]);

  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }, [points]);

  return (
    // @ts-expect-error - Three.js primitive, not SVG element
    <line geometry={lineGeometry}>
      <lineBasicMaterial color={isDimmed ? "#444444" : "#666666"} transparent opacity={isDimmed ? 0.3 : 0.4} />
    </line>
  );
};

// --- GRAPH SCENE COMPONENT ---
const GraphScene = ({
  nodes,
  links,
  nodeTypes,
  colorPalette,
  isDarkMode,
  onNodeClick,
  selectedNodeId,
}: Graph3DProps) => {
  const [simulatedNodes, setSimulatedNodes] = useState<D3Node[]>([]);
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Sync internal selection with parent
  useEffect(() => {
    if (selectedNodeId === null) {
      setSelectedNode(null);
    }
  }, [selectedNodeId]);

  // Auto-rotate animation
  useEffect(() => {
    const animate = () => {
      if (groupRef.current) {
        groupRef.current.rotation.y += 0.0001; // Slow horizontal rotation
      }
      requestAnimationFrame(animate);
    };
    const animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter((link) => {
      const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
      const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    // Assign nodes to layers based on their types
    const nodeToLayer = assignNodesToLayers(nodes);

    // Layer z-positions (spread across z-axis)
    const LAYER_SPACING = 250; // Distance between layers (increased for more dramatic separation)
    const layerZPositions = [
      -LAYER_SPACING, // Layer 0 (back): highest priority types
      0, // Layer 1 (middle)
      LAYER_SPACING, // Layer 2 (front): lowest priority types
    ];

    // Initialize z positions based on layers
    nodes.forEach((node) => {
      const layer = nodeToLayer.get(node.id) ?? 1; // Use ?? instead of || to handle 0 correctly
      node.z = layerZPositions[layer] + (Math.random() - 0.5) * 20; // Small random variation within layer
      node.layer = layer; // Store layer info on node
    });

    const simulation = d3
      .forceSimulation<D3Node>(nodes)
      .force(
        "link",
        d3
          .forceLink<D3Node, D3Link>(validLinks)
          .id((d) => d.id)
          .distance(50)
          .strength(0.5),
      )
      .force("charge", d3.forceManyBody().strength(-300).distanceMax(300))
      .force("x", d3.forceX(0).strength(0.1))
      .force("y", d3.forceY(0).strength(0.1))
      .force("collision", d3.forceCollide().radius(15).strength(0.7))
      // Add custom force to maintain z-layer separation
      .force("z", () => {
        const zStrength = 0.3;
        nodes.forEach((node) => {
          if (node.z !== undefined) {
            const layer = nodeToLayer.get(node.id) ?? 1; // Use ?? instead of || to handle 0 correctly
            const targetZ = layerZPositions[layer];
            const dz = targetZ - node.z;
            node.vz = (node.vz || 0) + dz * zStrength;
          }
        });
      });

    simulationRef.current = simulation;

    simulation.on("tick", () => {
      // Constrain z positions to stay roughly in their layers
      nodes.forEach((node) => {
        if (node.z !== undefined) {
          const layer = nodeToLayer.get(node.id) ?? 1; // Use ?? instead of || to handle 0 correctly
          const targetZ = layerZPositions[layer];
          const maxDeviation = 40; // Allow some deviation from exact layer position
          node.z = Math.max(targetZ - maxDeviation, Math.min(targetZ + maxDeviation, node.z));
        }
      });
      setSimulatedNodes([...nodes]);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  const handleNodeClick = (node: D3Node) => {
    setSelectedNode(node.id === selectedNode?.id ? null : node);
    if (onNodeClick) {
      onNodeClick(node);
    }
  };

  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const connected = new Set<string>();
    links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
      const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
      if (sourceId === selectedNode.id) connected.add(targetId);
      else if (targetId === selectedNode.id) connected.add(sourceId);
    });
    return connected;
  }, [selectedNode, links]);

  return (
    <>
      <ambientLight intensity={isDarkMode ? 0.3 : 0.5} />
      <directionalLight position={[10, 10, 5]} intensity={isDarkMode ? 0.5 : 1} />
      <pointLight position={[-10, -10, -5]} intensity={isDarkMode ? 0.3 : 0.5} />

      <group ref={groupRef}>
        {links.map((link, i) => {
          const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
          const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
          const isConnectedToSelected = selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);
          return (
            <LinkLine
              key={`${sourceId}-${targetId}-${i}`}
              link={link}
              isDimmed={selectedNode !== null && !isConnectedToSelected}
            />
          );
        })}

        {simulatedNodes.map((node) => {
          const isSelected = selectedNode?.id === node.id;
          const isConnected = selectedNode !== null && connectedNodeIds.has(node.id);
          const isDimmed = selectedNode !== null && !isSelected && !isConnected;

          return (
            <NodeMesh
              key={node.id}
              node={node}
              color={getNodeColor(node.type, nodeTypes, colorPalette)}
              onClick={() => handleNodeClick(node)}
              isSelected={isSelected}
              isConnected={isConnected}
              isDimmed={isDimmed}
            />
          );
        })}
      </group>

      <OrbitControls enableDamping dampingFactor={0.05} zoomSpeed={0.3} rotateSpeed={0.5} />
    </>
  );
};

// --- MAIN 3D GRAPH COMPONENT ---
export const Graph3D = ({
  nodes,
  links,
  nodeTypes,
  colorPalette,
  isDarkMode,
  onNodeClick,
  showCameraControls = false,
  selectedNodeId,
}: Graph3DProps) => {
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0, z: 0, distance: 0 });

  // Use a reasonable fixed camera distance based on typical graph size
  // This prevents the camera from jumping around as the simulation runs
  const initialDistance = useMemo(() => {
    // Estimate based on number of nodes - larger graphs need more distance
    const nodeCount = nodes.length;
    if (nodeCount < 10) return 300;
    if (nodeCount < 30) return 400;
    if (nodeCount < 50) return 500;
    return 600;
  }, [nodes.length]);

  const [cameraDistance, setCameraDistance] = useState(initialDistance);

  // Update camera distance when nodes change (but only once on mount)
  useEffect(() => {
    setCameraDistance(initialDistance);
  }, [initialDistance]);

  // Calculate actual optimal for display purposes only
  const optimalCameraDistance = useMemo(() => {
    if (nodes.length === 0) return 0;

    const positions = nodes.map((n) => ({
      x: n.x || 0,
      y: n.y || 0,
      z: n.z || 0,
    }));

    const maxX = Math.max(...positions.map((p) => Math.abs(p.x)), 1);
    const maxY = Math.max(...positions.map((p) => Math.abs(p.y)), 1);
    const maxZ = Math.max(...positions.map((p) => Math.abs(p.z)), 1);

    const maxDimension = Math.max(maxX, maxY, maxZ);

    if (maxDimension < 10) return initialDistance;

    return Math.max(maxDimension * 2, 300);
  }, [nodes, initialDistance]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center">
        <div className={`text-lg ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>No nodes to visualize</div>
      </div>
    );
  }

  // Calculate camera position - angled view to see layers
  const angle = Math.PI / 4; // 45 degrees (increased from 30)
  const initialCameraPos: [number, number, number] = [
    cameraDistance * Math.sin(angle),
    cameraDistance * 0.4,
    cameraDistance * Math.cos(angle),
  ];

  return (
    <div className="w-full h-[500px] relative">
      {showCameraControls && (
        <div
          className={`absolute top-2 left-2 z-10 p-3 rounded text-xs font-mono ${isDarkMode ? "bg-gray-800 text-gray-300" : "bg-white text-gray-700"} shadow-lg`}
        >
          <div>
            <strong>Camera Position:</strong>
          </div>
          <div>x: {cameraPos.x.toFixed(1)}</div>
          <div>y: {cameraPos.y.toFixed(1)}</div>
          <div>z: {cameraPos.z.toFixed(1)}</div>
          <div>distance: {cameraPos.distance.toFixed(1)}</div>
          <div className="mt-2">
            <strong>Optimal:</strong> {optimalCameraDistance.toFixed(1)}
          </div>
          <div className="mt-2">
            <label className="block mb-1">Distance:</label>
            <input
              type="range"
              min="100"
              max="1000"
              value={cameraDistance}
              onChange={(e) => setCameraDistance(Number(e.target.value))}
              className="w-full"
            />
            <div>{cameraDistance.toFixed(0)}</div>
          </div>
        </div>
      )}
      <Canvas camera={{ position: initialCameraPos, fov: 75 }}>
        <color attach="background" args={[isDarkMode ? "#111827" : "#f9fafb"]} />
        <CameraController
          distance={cameraDistance}
          onUpdate={
            showCameraControls
              ? (pos, dist) => setCameraPos({ x: pos.x, y: pos.y, z: pos.z, distance: dist })
              : undefined
          }
        />
        <GraphScene
          nodes={nodes}
          links={links}
          nodeTypes={nodeTypes}
          colorPalette={colorPalette}
          isDarkMode={isDarkMode}
          onNodeClick={onNodeClick}
          selectedNodeId={selectedNodeId}
        />
      </Canvas>
    </div>
  );
};
