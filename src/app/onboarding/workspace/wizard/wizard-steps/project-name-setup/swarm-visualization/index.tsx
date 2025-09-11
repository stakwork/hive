// SwarmVisualization.tsx
// deps: tailwindcss + framer-motion
// npm i framer-motion
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

/** ---------- Configurable duration ---------- */
const TOTAL_DURATION_MS = 2 * 60 * 1000; // 2 minutes (change this variable)

/** ---------- Types ---------- */
export type NodeDef = { id: string; name: string; version?: string; icon: string };
type Connection = { from: NodeDef["id"]; to: NodeDef["id"] };
type PlacedNode = NodeDef & { x: number; y: number };

/** ---------- Data ---------- */
const NODES: NodeDef[] = [
  { id: "neo4j", name: "Neo4j", version: "5.19.0", icon: "🔵" },
  { id: "boltwall", name: "BoltWall", version: ":8444", icon: "⚡" },
  { id: "jarvis", name: "Jarvis", version: ":6000", icon: "🧠" },
  { id: "repo2graph", name: "Repo2Graph", version: ":3355", icon: "📊" },
  { id: "stakgraph", name: "StakGraph", version: ":7799", icon: "📈" },
];

const CONNECTIONS: Connection[] = [
  { from: "jarvis", to: "neo4j" },
  { from: "boltwall", to: "neo4j" },
  { from: "repo2graph", to: "neo4j" },
  { from: "stakgraph", to: "neo4j" },
];


/** ---------- Layout helpers ---------- */
const GAP = 32;
const ROW_SEP = 120;
const STAGE_ASPECT = "5/3";
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, set] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      set({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}
function layoutRows(nodes: NodeDef[], stageW: number, stageH: number): PlacedNode[] {
  const hub = nodes.find(n => n.id === "neo4j")!;
  const sats = nodes.filter(n => n.id !== "neo4j");
  const cx = stageW / 2, cy = stageH / 2;

  // Split into top/bottom rows
  const mid = Math.ceil(sats.length / 2);
  const top = sats.slice(0, mid);
  const bot = sats.slice(mid);

  const row = (arr: NodeDef[], y: number) => {
    const total = arr.length * 240 + (arr.length - 1) * GAP;
    let x = cx - total / 2;
    return arr.map(n => {
      const placed = { ...n, x: x + 120, y }; // center card
      x += 240 + GAP;
      return placed;
    });
  };

  return [...row(top, cy - ROW_SEP), ...row(bot, cy + ROW_SEP), { ...hub, x: cx, y: cy }];
}
function arcPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const k = Math.min(0.18 * dist, 90);
  const perpX = (-dy / dist) * k, perpY = (dx / dist) * k;
  return `M ${a.x} ${a.y} Q ${mx + perpX} ${my + perpY} ${b.x} ${b.y}`;
}

/** ---------- UI ---------- */
function NodeCard({ node, active, x, y }: { node: PlacedNode; active: boolean; x: number; y: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className={[
        "absolute -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl px-4 py-3 min-w-[220px]",
        "backdrop-blur-md border text-white",
        active
          ? "border-emerald-400/70 shadow-[0_0_40px_#10b98155] bg-white/10"
          : "border-white/10 bg-white/5",
      ].join(" ")}
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-3">
        <div
          className={[
            "h-10 w-10 rounded-xl grid place-items-center text-lg",
            active
              ? "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-[0_0_20px_#10b98166]"
              : "bg-gradient-to-br from-slate-600 to-slate-700",
          ].join(" ")}
        >
          {node.icon}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">{node.name}</span>
          {node.version && <span className="text-xs opacity-70">{node.version}</span>}
        </div>
      </div>
    </motion.div>
  );
}

/** ---------- Main ---------- */
export function SwarmVisualization() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const placed = useMemo(() => layoutRows(NODES, size.w, size.h), [size.w, size.h]);

  // progress state
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(t);
  }, []);
  const progress = Math.min(elapsed / TOTAL_DURATION_MS, 1);


  const map = useMemo(() => {
    const m = new Map<string, PlacedNode>();
    placed.forEach(p => m.set(p.id, p));
    return m;
  }, [placed]);

  return (
    <div className="w-full bg-slate-950 text-white flex flex-col items-center justify-center">

      <div
        ref={stageRef}
        className="relative w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10"
        style={{ aspectRatio: STAGE_ASPECT }}
      >
        {/* Radar sweep */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from ${elapsed / 50}deg, rgba(56,189,248,0.15), transparent 60%)`,
            maskImage: "radial-gradient(circle, black 70%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle, black 70%, transparent 100%)",
          }}
        />

        {/* Links */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="connGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {CONNECTIONS.map((c, i) => {
            const a = map.get(c.from);
            const b = map.get(c.to);
            if (!a || !b) return null;
            const path = arcPath(a, b);
            return (
              <g key={`${c.from}-${c.to}-${i}`}>
                <motion.path
                  d={path}
                  stroke="url(#connGrad)"
                  strokeWidth={2 + progress * 2}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1, delay: i * 0.2 }}
                  fill="none"
                />
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {placed.map(n => (
          <NodeCard
            key={n.id}
            node={n}
            x={n.x}
            y={n.y}
            active={n.id === "neo4j" || progress > 0.3}
          />
        ))}

        {/* Hub progress ring */}
        {(() => {
          const hub = map.get("neo4j");
          if (!hub) return null;
          const radius = 70;
          const circ = 2 * Math.PI * radius;
          return (
            <svg
              className="absolute"
              style={{ left: hub.x, top: hub.y, transform: "translate(-50%,-50%)" }}
              width={radius * 2 + 20}
              height={radius * 2 + 20}
            >
              <circle
                cx="50%"
                cy="50%"
                r={radius}
                stroke="rgba(59,130,246,0.2)"
                strokeWidth="6"
                fill="none"
              />
              <motion.circle
                cx="50%"
                cy="50%"
                r={radius}
                stroke="url(#connGrad)"
                strokeWidth="6"
                fill="none"
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - progress)}
              />
            </svg>
          );
        })()}
      </div>

    </div>
  );
}
