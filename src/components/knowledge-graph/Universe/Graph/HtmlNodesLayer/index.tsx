import { useGraphStore, useSimulationStore } from '@/stores/useStores';
import { Html } from '@react-three/drei';
import { NodeExtended } from '@Universe/types';
import { memo, useMemo, useState } from 'react';
import { useNodeNavigation } from '../../useNodeNavigation';

interface HtmlNodesLayerProps {
  nodeTypes: string[];
  enabled?: boolean;
}

const CalloutLabel = ({
  node,
  onNodeHover,
  onNodeUnhover,
  onNodeClick
}: {
  node: NodeExtended;
  onNodeHover: (node: NodeExtended) => void;
  onNodeUnhover: () => void;
  onNodeClick: (nodeId: string) => void;
}) => {
  const [hovered, setHovered] = useState(false);

  // Theme & Data extraction
  const baseColor = node?.color || '#06b6d4';
  const displayTitle = (node?.name || node.properties?.title || node.properties?.name || 'Unknown').slice(0, 54);
  const val = node.properties?.value || Math.floor(Math.random() * 100);

  // Geometry Settings for the Callout Line
  // Design: Marker at (0,0). Line starts at center, goes to elbow, then extends.
  // Adjusted elbow to clear the larger marker.
  const elbowX = 35;
  const elbowY = -35;
  const collapsedWidth = 120;
  const expandedWidth = 160;
  const currentWidth = hovered ? expandedWidth : collapsedWidth;

  const onPointerOver = () => {
    setHovered(true);
    onNodeHover(node);
  }

  const onPointerOut = () => {
    setHovered(false);
    onNodeUnhover();
  }

  const onPointerClick = () => {
    onNodeClick(node.ref_id);
  }

  return (
    <div
      className="relative pointer-events-auto select-none group"
      onMouseEnter={onPointerOver}
      onMouseLeave={onPointerOut}
      onClick={onPointerClick}
    >
      {/* --- MARKER (Center 0,0) --- */}
      <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer z-10">
        {/* Tech Octagon Marker */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          className={`overflow-visible transition-all duration-500 ease-out origin-center ${hovered ? 'scale-110 rotate-180' : 'scale-100'}`}
        >
          <defs>
            <filter id={`glow-marker-${node.ref_id}`}>
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={baseColor} floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Outer Ring / Octagon */}
          <path
            d="M7,2 L17,2 L22,7 L22,17 L17,22 L7,22 L2,17 L2,7 Z"
            fill="#000000"
            fillOpacity="0.6"
            stroke={baseColor}
            strokeWidth={hovered ? 2 : 1.5}
            filter={`url(#glow-marker-${node.ref_id})`}
            className="transition-colors duration-300"
          />

          {/* Inner Graphic (Square) */}
          <rect
            x="8" y="8" width="8" height="8"
            fill={baseColor}
            className={`transition-all duration-300 ${hovered ? 'opacity-100 scale-75' : 'opacity-60 scale-100'}`}
            style={{ transformOrigin: 'center' }}
          />

          {/* Tech details: External Ticks visible on hover */}
          {hovered && (
            <g stroke="white" strokeWidth="1" opacity="0.8">
              <line x1="2" y1="7" x2="-2" y2="7" />
              <line x1="22" y1="7" x2="26" y2="7" />
              <line x1="2" y1="17" x2="-2" y2="17" />
              <line x1="22" y1="17" x2="26" y2="17" />
            </g>
          )}
        </svg>
      </div>

      {/* --- CONNECTOR LINE (SVG) --- */}
      <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" style={{ zIndex: -1 }}>
        {/* The Leader Line Path */}
        <path
          d={`M 0,0 L ${elbowX},${elbowY} L ${elbowX + currentWidth},${elbowY}`}
          fill="none"
          stroke={baseColor}
          strokeWidth={hovered ? 2 : 1}
          strokeOpacity={hovered ? 1 : 0.5}
          className="transition-all duration-300 ease-out"
        />

        {/* Joint Decoration at Elbow */}
        <circle
          cx={elbowX} cy={elbowY} r={hovered ? 2 : 1.5}
          fill={baseColor}
          className="transition-all duration-300"
        />

        {/* Animated "Data Packet" moving along the line */}
        {hovered && (
          <circle r="2" fill="white" filter={`url(#glow-marker-${node.ref_id})`}>
            <animateMotion
              dur="1s"
              repeatCount="indefinite"
              path={`M 0,0 L ${elbowX},${elbowY} L ${elbowX + currentWidth},${elbowY}`}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </circle>
        )}
      </svg>

      {/* --- LABEL CONTENT --- */}
      <div
        className="absolute transition-all duration-300 ease-out z-20"
        style={{
          left: `${elbowX}px`,
          top: `${elbowY}px`,
          transform: 'translate(0, -100%)' // Align bottom of box to the line
        }}
      >
        <div
          className="flex flex-col pl-3 pb-1.5"
          style={{ width: `${currentWidth + 20}px` }}
        >
          {/* Metadata Header */}
          <div className={`
                flex items-center space-x-2 text-[10px] font-mono mb-0.5 transition-opacity duration-300
                ${hovered ? 'opacity-100' : 'opacity-70'}
            `}>
          </div>

          {/* Main Title */}
          <div
            className="text-sm font-bold text-white whitespace-nowrap overflow-hidden transition-all duration-300"
            style={{
              textShadow: hovered ? `0 0 10px ${baseColor}` : 'none',
            }}
          >
            {displayTitle}
          </div>

          {/* Collapsible Detail View */}
          <div
            className={`
                    mt-1 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]
                    ${hovered ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0'}
                `}
          >
            {/* Decorative Separator */}
            <div
              className="h-0.5 w-full my-1.5 origin-left"
              style={{ background: `linear-gradient(90deg, ${baseColor}, transparent)` }}
            />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 gap-1 bg-black/80 backdrop-blur-md p-2 rounded border border-white/10 shadow-xl">
              <div className="flex justify-between items-center text-[10px] font-mono text-gray-300">
                <span className="text-gray-500">SIGNAL_STR</span>
                <div className="flex items-center space-x-1">
                  <span style={{ color: baseColor }}>{val} Hz</span>
                  <div className="w-8 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-white" style={{ width: `${(val / 1000) * 100}%` }} />
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-gray-300">
                <span className="text-gray-500">COORDS</span>
                <span>{node.x.toFixed(0)} : {node.y.toFixed(0)} : {node.z.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const HtmlNodesLayer = memo<HtmlNodesLayerProps>(({ nodeTypes, enabled = true }) => {
  const { simulation } = useSimulationStore((s) => s);
  const { setHoveredNode } = useGraphStore((s) => s);
  const { navigateToNode } = useNodeNavigation();

  const filteredNodes = useMemo(() => {
    if (!enabled || nodeTypes.length === 0) return [];

    const simulationNodes = simulation?.nodes() || [];
    return simulationNodes.filter((node: NodeExtended) =>
      nodeTypes.includes(node.node_type)
    );
  }, [simulation, nodeTypes, enabled]);

  const handleNodeHover = (node: NodeExtended) => {
    setHoveredNode(node);
  };

  const handleNodeUnhover = () => {
    setHoveredNode(null);
  };

  const handleNodeClick = (nodeId: string) => {
    navigateToNode(nodeId);
  };

  if (!enabled || filteredNodes.length === 0) return null;

  return (
    <group name="html-nodes-layer">
      {filteredNodes.map((node: NodeExtended) => (
        <Html
          key={`html-${node.ref_id}`}
          position={[node.x || 0, node.y || 0, node.z || 0]}
          center
          zIndexRange={[100, 0]}
          occlude="blending"
          style={{
            transition: 'opacity 0.2s',
            pointerEvents: 'none',
            willChange: 'transform'
          }}
        >
          <CalloutLabel
            node={node}
            onNodeHover={handleNodeHover}
            onNodeUnhover={handleNodeUnhover}
            onNodeClick={handleNodeClick}
          />
        </Html>
      ))}
    </group>
  );
});

HtmlNodesLayer.displayName = 'HtmlNodesLayer';