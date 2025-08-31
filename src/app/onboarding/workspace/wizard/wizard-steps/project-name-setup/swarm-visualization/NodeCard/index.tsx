import { NodeDef } from "..";

type NodeCardProps = {
  node: NodeDef;
  highlighted: boolean;
  nextCandidate: boolean;
  connected: boolean;
  // scaled dimensions and position (already computed by the parent)
  left: number;
  top: number;
  width: number;
  height: number;
};

export function NodeCard({
  node,
  highlighted,
  nextCandidate,
  connected,
  left,
  top,
  width,
  height,
}: NodeCardProps) {
  return (
    <div
      className={`absolute cursor-pointer transition-all duration-500 ease-in-out ${highlighted
        ? "scale-110 z-30"
        : nextCandidate
          ? "scale-105 z-20"
          : connected
            ? "scale-105 z-10"
            : "scale-100 z-0"
        }`}
      style={{ left, top, width, height }}
    >
      <div
        className={`relative w-full h-full rounded-xl p-3 text-center border-2 transition-all duration-500 flex flex-col items-center justify-center ${highlighted
          ? "border-blue-400 bg-stone-600 shadow-lg"
          : nextCandidate
            ? "border-blue-400 bg-slate-700"
            : connected
              ? "border-blue-500 bg-slate-700"
              : "border-slate-600 hover:border-slate-500 bg-slate-700"
          }`}
        style={{
          boxShadow: highlighted
            ? "0 0 20px lime"
            : nextCandidate
              ? "0 0 15px rgba(96, 165, 250, 0.5)"
              : "none",
        }}
      >
        <div className="text-lg mb-1">{node.icon}</div>
        <div className="text-white font-semibold text-xs leading-tight">{node.name}</div>

        {highlighted && (
          <div
            className="absolute inset-0 border-2 border-blue-300 rounded-xl opacity-75"
          />
        )}

        {nextCandidate && (
          <div
            className="absolute inset-0 border-2 border-blue-300 rounded-xl"
            style={{ animation: "nextPulse 1.5s infinite" }}
          />
        )}
      </div>
    </div>
  );
}