import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NodeCard } from "./NodeCard";

// ---------- Types ----------
export type NodeDef = {
  id: string;
  name: string;
  version?: string;
  x: number; // base coords in the 1000x400 logical canvas
  y: number;
  icon: string;
};

type Connection = {
  from: NodeDef["id"];
  to: NodeDef["id"];
};

// ---------- Constants (base logical canvas) ----------
const BASE_W = 1000;
const BASE_H = 400;
const CARD_W = 140;
const CARD_H = 100;
const DELAY_MS = 7000;

// ---------- Data ----------
const nodes: NodeDef[] = [
  { id: "neo4j", name: "Neo4j", version: "5.19.0", x: 400, y: 200, icon: "🔵" },
  { id: "boltwall", name: "BoltWall", version: ":8444", x: 350, y: 50, icon: "⚡" },
  { id: "jarvis", name: "Jarvis", version: ":6000", x: 150, y: 200, icon: "🧠" },
  { id: "repo2graph", name: "Repo2Graph", version: ":3355", x: 850, y: 120, icon: "📊" },
  { id: "stakgraph", name: "StakGraph", version: ":7799", x: 850, y: 280, icon: "📈" },
];

const connections: Connection[] = [
  { from: "jarvis", to: "neo4j" },
  { from: "boltwall", to: "jarvis" },
  { from: "repo2graph", to: "neo4j" },
  { from: "stakgraph", to: "neo4j" },
];

// ---------- Responsive hook ----------
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

export const SwarmVisualization = () => {
  const [visibleNodes, setVisibleNodes] = useState<string[]>([]);
  const [highlightedNodes, setHighlightedNodes] = useState<string[]>([]);
  const [nextNode, setNextNode] = useState<string | null>(nodes[0]?.id ?? null);
  const indexRef = useRef<number>(0);

  // Outer responsive box keeps width fluid; height is derived to maintain aspect ratio (BASE_W:BASE_H)
  const { ref: boxRef, size: boxSize } = useElementSize<HTMLDivElement>();
  const scaleX = boxSize.width > 0 ? boxSize.width / BASE_W : 1;
  const scaleY = (boxSize.width * BASE_H) / BASE_W > 0 ? (boxSize.width * BASE_H) / BASE_W / BASE_H : 1; // same as scaleX; left explicit in case you change aspect rules later

  // Node appearance and highlight cycle
  useEffect(() => {
    if (nodes.length === 0) return;

    const interval = setInterval(() => {
      const currentIndex = indexRef.current;
      const currentNodeId = nodes[currentIndex]?.id;

      if (currentNodeId) {
        // Make the current node visible
        setVisibleNodes((prev) => {
          return prev.includes(currentNodeId) ? prev : [...prev, currentNodeId];
        });

        // Highlight the current node
        setHighlightedNodes((prev) => {
          return prev.includes(currentNodeId) ? prev : [...prev, currentNodeId];
        });
      }

      // Set next node for preview
      const nextIndex = (currentIndex + 1) % nodes.length;
      setNextNode(nodes[nextIndex]?.id ?? null);
      indexRef.current = nextIndex;
    }, DELAY_MS);

    return () => clearInterval(interval);
  }, []);

  // Helpers
  const isNodeVisible = (nodeId: string) => visibleNodes.includes(nodeId);
  const isNodeHighlighted = (nodeId: string) => highlightedNodes.includes(nodeId);
  const isNodeConnected = (nodeId: string) =>
    highlightedNodes.some((hid) =>
      connections.some(
        (c) =>
          (c.from === hid && c.to === nodeId) || (c.to === hid && c.from === nodeId),
      ),
    );
  const isNextCandidate = (nodeId: string) => nodeId === nextNode;
  const isConnectionHighlighted = (c: Connection) =>
    highlightedNodes.includes(c.from) || highlightedNodes.includes(c.to);
  const isConnectionVisible = (c: Connection) =>
    visibleNodes.includes(c.from) && visibleNodes.includes(c.to);

  const getConnectionPath = (from: string, to: string): string => {
    const a = nodes.find((n) => n.id === from);
    const b = nodes.find((n) => n.id === to);
    if (!a || !b) return "";

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return `M ${a.x} ${a.y} l 0.01 0.01`;

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const curvature = Math.min(dist * 0.15, 60);
    const perpX = (-dy / dist) * curvature;
    const perpY = (dx / dist) * curvature;

    return `M ${a.x} ${a.y} Q ${midX + perpX} ${midY + perpY} ${b.x} ${b.y}`;
  };

  // Derived height to maintain aspect ratio
  const computedHeight = boxSize.width > 0 ? (boxSize.width * BASE_H) / BASE_W : BASE_H;

  return (
    <div className="w-full flex flex-col items-center justify-center">
      <div
        ref={boxRef}
        className="relative rounded-2xl shadow-2xl w-full max-w-6xl"
        style={{ height: computedHeight }}
      >
        {/* Edges: SVG scales via viewBox */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${BASE_W} ${BASE_H}`}>
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {connections.map((c) => {
            if (!isConnectionVisible(c)) return null;

            return (
              <path
                key={`${c.from}-${c.to}`}
                d={getConnectionPath(c.from, c.to)}
                stroke={isConnectionHighlighted(c) ? "lime" : "#475569"}
                strokeWidth={isConnectionHighlighted(c) ? 3 : 2}
                fill="none"
                className="transition-all duration-500 ease-in-out"
                filter={isConnectionHighlighted(c) ? "url(#glow)" : "none"}
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          if (!isNodeVisible(node.id)) return null;

          const width = CARD_W * scaleX;
          const height = CARD_H * scaleY; // same ratio here
          const left = node.x * scaleX - width / 2;
          const top = node.y * scaleY - height / 2;

          return (
            <NodeCard
              key={node.id}
              node={node}
              highlighted={isNodeHighlighted(node.id)}
              nextCandidate={isNextCandidate(node.id)}
              connected={isNodeConnected(node.id)}
              left={left}
              top={top}
              width={width}
              height={height}
            />
          );
        })}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 0.75;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.05);
          }
        }
        @keyframes nextPulse {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.02);
          }
        }
      `}</style>
    </div>
  );
};