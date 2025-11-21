import { useDataStore, useSimulationStore } from "@/stores/useStores";
import { NodeExtended } from "@Universe/types";
import { Html } from "@react-three/drei";
import { memo, useMemo } from "react";

interface HtmlNodesLayerProps {
  nodeTypes: string[];
  enabled?: boolean;
}

export const HtmlNodesLayer = memo<HtmlNodesLayerProps>(({ nodeTypes, enabled = true }) => {
  const { simulation } = useSimulationStore((s) => s);
  const nodesNormalized = useDataStore((s) => s.nodesNormalized);

  const simulationNodes = simulation?.nodes() || [];

  // Helper function to determine font size based on name length
  const getFontSizeClass = (name: string) => {
    const length = name.length;
    if (length <= 20) return "text-sm"; // 14px for short names
    if (length <= 35) return "text-xs"; // 12px for medium names
    return "text-[11px]"; // 11px for long names (hard minimum)
  };

  // Filter nodes by the specified types
  const filteredNodes = useMemo(() => {
    if (!enabled || nodeTypes.length === 0) return [];

    return simulationNodes.filter((node: NodeExtended) => nodeTypes.includes(node.node_type));
  }, [simulationNodes, nodeTypes, enabled]);

  if (!enabled || filteredNodes.length === 0) return null;

  return (
    <group name="html-nodes-layer">
      {filteredNodes.map((node: NodeExtended) => (
        <Html
          key={`html-${node.ref_id}`}
          position={[node.x || 0, node.y || 0, node.z || 0]}
          center
          sprite
          zIndexRange={[100, 0]}
        >
          <div className="group relative">
            {/* Glow effect background */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 rounded-lg blur-sm animate-pulse"></div>

            {/* Main card */}
            <div className="relative bg-gradient-to-br from-background via-background/95 to-background/90 text-foreground px-3 py-2 rounded-lg border border-primary/30 shadow-xl backdrop-blur-md text-xs min-w-[140px] max-w-[220px] transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:border-primary/50">
              {/* Node type indicator */}
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={`w-2 h-2 rounded-full ${
                    node.node_type === "Feature"
                      ? "bg-emerald-400"
                      : node.node_type === "Function"
                        ? "bg-blue-400"
                        : node.node_type === "Class"
                          ? "bg-purple-400"
                          : node.node_type === "File"
                            ? "bg-orange-400"
                            : "bg-gray-400"
                  } shadow-lg animate-pulse`}
                ></div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  {node.node_type}
                </span>
              </div>

              {/* Node name */}
              <div
                className={`font-semibold break-words line-clamp-2 ${getFontSizeClass(node.name || node.properties?.name || node.properties?.title || "")} leading-tight text-foreground group-hover:text-primary transition-colors duration-200`}
              >
                {node.name || node.properties?.name || node.properties?.title || "Unnamed"}
              </div>

              {/* Additional info if available */}
              {/* {(node.properties?.description || node.properties?.summary) && (
                <div className="text-[10px] text-muted-foreground mt-1 truncate opacity-70">
                  {node.properties?.description || node.properties?.summary}
                </div>
              )} */}

              {/* Subtle gradient line at bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-b-lg"></div>
            </div>
          </div>
        </Html>
      ))}
    </group>
  );
});

HtmlNodesLayer.displayName = "HtmlNodesLayer";
