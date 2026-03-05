"use client";

// Lightweight mock of the knowledge graph canvas
export function MockGraph() {
  return (
    <div className="w-full h-full bg-[#08080f] relative overflow-hidden select-none">
      {LAYER_LINES.map((l) => (
        <div
          key={l.label}
          className="absolute left-0 right-0 border-t border-white/[0.04]"
          style={{ top: `${l.y}%` }}
        />
      ))}
      {LAYER_LINES.map((l) => (
        <div
          key={l.label + "-txt"}
          className="absolute left-3 text-[9px] font-mono opacity-20 text-white"
          style={{ top: `calc(${l.y}% + 4px)` }}
        >
          {l.label}
        </div>
      ))}
      {NODES.map((n) => (
        <div
          key={n.id}
          className="absolute rounded-full"
          style={{
            left: `${n.x}%`,
            top: `${n.y}%`,
            width: n.r,
            height: n.r,
            background: n.c,
            boxShadow: `0 0 ${n.r * 2.5}px ${n.c}55`,
            transform: "translate(-50%,-50%)",
          }}
        />
      ))}
    </div>
  );
}

const LAYER_LINES = [
  { label: "SERVICES",   y: 10 },
  { label: "FILES",      y: 26 },
  { label: "DATAMODELS", y: 42 },
  { label: "FUNCTIONS",  y: 58 },
  { label: "ENDPOINTS",  y: 74 },
  { label: "TESTS",      y: 88 },
];

const NODES = [
  // services
  { id:1,  x:18, y:10, r:14, c:"#7c6af7" },
  { id:2,  x:44, y:10, r:10, c:"#7c6af7" },
  { id:3,  x:66, y:11, r:12, c:"#7c6af7" },
  { id:4,  x:82, y:10, r: 8, c:"#7c6af7" },
  // files
  { id:5,  x:14, y:26, r: 8, c:"#3b82f6" },
  { id:6,  x:30, y:26, r: 6, c:"#3b82f6" },
  { id:7,  x:50, y:27, r:10, c:"#3b82f6" },
  { id:8,  x:70, y:26, r: 7, c:"#3b82f6" },
  { id:9,  x:86, y:26, r: 9, c:"#3b82f6" },
  // datamodels
  { id:10, x:22, y:42, r: 9, c:"#10b981" },
  { id:11, x:40, y:42, r: 7, c:"#10b981" },
  { id:12, x:60, y:43, r:11, c:"#10b981" },
  { id:13, x:78, y:42, r: 8, c:"#10b981" },
  // functions
  { id:14, x:16, y:58, r: 7, c:"#f59e0b" },
  { id:15, x:34, y:59, r: 5, c:"#f59e0b" },
  { id:16, x:52, y:57, r: 8, c:"#f59e0b" },
  { id:17, x:68, y:60, r: 6, c:"#f59e0b" },
  { id:18, x:84, y:58, r: 9, c:"#f59e0b" },
  // endpoints
  { id:19, x:24, y:74, r: 8, c:"#ef4444" },
  { id:20, x:48, y:75, r: 6, c:"#ef4444" },
  { id:21, x:72, y:73, r:10, c:"#ef4444" },
  // tests
  { id:22, x:20, y:88, r: 6, c:"#8b5cf6" },
  { id:23, x:40, y:89, r: 5, c:"#8b5cf6" },
  { id:24, x:60, y:88, r: 7, c:"#8b5cf6" },
  { id:25, x:78, y:88, r: 5, c:"#8b5cf6" },
];
