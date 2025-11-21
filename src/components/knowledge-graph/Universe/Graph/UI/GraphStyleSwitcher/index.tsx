import { Button } from "@/components/ui/button";
import { useGraphStore, GraphStyle, graphStyles, useSimulationStore } from "@/stores/useStores";
import { useMemo } from "react";

const graphStyleLabels: Record<GraphStyle, string> = {
  sphere: "Sphere",
  force: "Force",
  split: "Layered",
};

const graphStyleDescriptions: Record<GraphStyle, string> = {
  sphere: "Spherical layout with radial forces",
  force: "Clustered layout grouped by neighborhoods",
  split: "Layered layout based on node types",
};

export const GraphStyleSwitcher = () => {
  const currentGraphStyle = useGraphStore((s) => s.graphStyle);
  const setGraphStyle = useGraphStore((s) => s.setGraphStyle);
  const setForces = useSimulationStore((s) => s.setForces);

  const handleStyleChange = (style: GraphStyle) => {
    if (style !== currentGraphStyle) {
      setGraphStyle(style);
      // Trigger simulation forces update
      setTimeout(() => {
        setForces();
      }, 100);
    }
  };

  const currentStyleInfo = useMemo(
    () => ({
      label: graphStyleLabels[currentGraphStyle],
      description: graphStyleDescriptions[currentGraphStyle],
    }),
    [currentGraphStyle],
  );

  return (
    <div className="fixed top-4 right-4 z-50 bg-black/80 backdrop-blur-sm rounded-lg p-4 border border-white/20">
      <div className="mb-3">
        <h3 className="text-white font-semibold text-sm mb-1">Graph Layout</h3>
        <p className="text-white/70 text-xs">{currentStyleInfo.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        {graphStyles.map((style) => (
          <Button
            key={style}
            variant={currentGraphStyle === style ? "default" : "outline"}
            size="sm"
            onClick={() => handleStyleChange(style)}
            className={`
              text-left justify-start transition-all duration-200
              ${
                currentGraphStyle === style
                  ? "bg-purple-600 hover:bg-purple-700 text-white border-purple-500"
                  : "bg-black/50 hover:bg-white/10 text-white/90 border-white/20 hover:border-white/40"
              }
            `}
          >
            {graphStyleLabels[style]}
          </Button>
        ))}
      </div>
    </div>
  );
};
