"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as d3 from "d3";

// Camera controller
const CameraController = ({
  distance,
  onUpdate
}: {
  distance: number;
  onUpdate?: (pos: THREE.Vector3, distance: number) => void;
}) => {
  const { camera } = useThree();

  useEffect(() => {
    // Straight-on view - camera positioned directly in front
    const newPos = new THREE.Vector3(
      0,
      0,
      distance
    );
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

  const scale = isSelected ? 1.5 : isConnected ? 1.2 : 1;
  const opacity = isDimmed ? 0.3 : 1;

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
  const ref = useRef<THREE.Line>(null);

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
    <line ref={ref} geometry={lineGeometry}>
      <lineBasicMaterial color={isDimmed ? "#444444" : "#666666"} transparent opacity={isDimmed ? 0.1 : 0.4} />
    </line>
  );
};

// --- GRAPH SCENE COMPONENT ---
const GraphScene = ({ nodes, links, nodeTypes, colorPalette, isDarkMode, onNodeClick, showCameraControls }: Graph3DProps) => {
  const [simulatedNodes, setSimulatedNodes] = useState<D3Node[]>([]);
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);

  useEffect(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter((link) => {
      const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
      const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    // Initialize z positions with tighter spread
    nodes.forEach((node) => {
      if (node.z === undefined) {
        node.z = (Math.random() - 0.5) * 50; // Reduced from 100 to 50
      }
    });

    const simulation = d3
      .forceSimulation<D3Node>(nodes)
      .force(
        "link",
        d3
          .forceLink<D3Node, D3Link>(validLinks)
          .id((d) => d.id)
          .distance(50)
          .strength(0.5)
      )
      .force("charge", d3.forceManyBody().strength(-300).distanceMax(300))
      .force("x", d3.forceX(0).strength(0.1))
      .force("y", d3.forceY(0).strength(0.1))
      .force("collision", d3.forceCollide().radius(15).strength(0.7));

    simulationRef.current = simulation;

    simulation.on("tick", () => {
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

      {links.map((link, i) => {
        const sourceId = typeof link.source === "string" ? link.source : (link.source as D3Node).id;
        const targetId = typeof link.target === "string" ? link.target : (link.target as D3Node).id;
        const isConnectedToSelected =
          selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);
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

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        zoomSpeed={0.3}
        rotateSpeed={0.5}
      />
    </>
  );
};

// --- MAIN 3D GRAPH COMPONENT ---
export const Graph3D = ({ nodes, links, nodeTypes, colorPalette, isDarkMode, onNodeClick, showCameraControls = false }: Graph3DProps) => {
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

    const positions = nodes.map(n => ({
      x: n.x || 0,
      y: n.y || 0,
      z: n.z || 0
    }));

    const maxX = Math.max(...positions.map(p => Math.abs(p.x)), 1);
    const maxY = Math.max(...positions.map(p => Math.abs(p.y)), 1);
    const maxZ = Math.max(...positions.map(p => Math.abs(p.z)), 1);

    const maxDimension = Math.max(maxX, maxY, maxZ);

    if (maxDimension < 10) return initialDistance;

    return Math.max(maxDimension * 2, 300);
  }, [nodes, initialDistance]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center">
        <div className={`text-lg ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
          No nodes to visualize
        </div>
      </div>
    );
  }

  // Calculate camera position - straight-on view
  const initialCameraPos: [number, number, number] = [
    0,
    0,
    cameraDistance
  ];

  return (
    <div className="w-full h-[500px] relative">
      {showCameraControls && (
        <div className={`absolute top-2 left-2 z-10 p-3 rounded text-xs font-mono ${isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'} shadow-lg`}>
          <div><strong>Camera Position:</strong></div>
          <div>x: {cameraPos.x.toFixed(1)}</div>
          <div>y: {cameraPos.y.toFixed(1)}</div>
          <div>z: {cameraPos.z.toFixed(1)}</div>
          <div>distance: {cameraPos.distance.toFixed(1)}</div>
          <div className="mt-2"><strong>Optimal:</strong> {optimalCameraDistance.toFixed(1)}</div>
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
          onUpdate={showCameraControls ? (pos, dist) => setCameraPos({ x: pos.x, y: pos.y, z: pos.z, distance: dist }) : undefined}
        />
        <GraphScene
          nodes={nodes}
          links={links}
          nodeTypes={nodeTypes}
          colorPalette={colorPalette}
          isDarkMode={isDarkMode}
          onNodeClick={onNodeClick}
          showCameraControls={showCameraControls}
        />
      </Canvas>
    </div>
  );
};
