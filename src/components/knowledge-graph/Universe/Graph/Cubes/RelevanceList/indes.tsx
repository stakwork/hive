import { StoreProvider, useStoreId } from "@/stores/StoreProvider";
import { useGraphStore } from "@/stores/useStores";
import { Billboard, Html } from "@react-three/drei";
import { useMemo, useState } from "react";
import { nodeSize } from "../constants";
import { NodeCard } from "./NodeCard";
import { NodeList } from "./NodeList";

export const RelevanceList = () => {
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const [showList, setShowList] = useState(false);

  const storeId = useStoreId();

  const centerPos = useMemo(
    () => [selectedNode?.x || 0, selectedNode?.y || 0, selectedNode?.z || 0] as [number, number, number],
    [selectedNode?.x, selectedNode?.y, selectedNode?.z],
  );

  if (!selectedNode) {
    return null;
  }

  return (
    <Billboard position={centerPos}>
      <group position={[nodeSize * 7, 0, 0]}>
        <Html distanceFactor={100} sprite transform>
          <StoreProvider storeId={storeId}>
            <div className="flex flex-col max-w-[400px] max-h-[500px]">
              {/* Toggle Button */}
              <div className="mb-2 flex gap-2">
                <button
                  onClick={() => setShowList(false)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    showList === false ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  Details
                </button>
                <button
                  onClick={() => setShowList(true)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    showList === true ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  Related Nodes
                </button>
              </div>

              {/* Content */}
              <div className="overflow-hidden">
                {showList ? (
                  <div className="max-w-[400px] max-h-[500px]">
                    <NodeList />
                  </div>
                ) : (
                  <NodeCard node={selectedNode} />
                )}
              </div>
            </div>
          </StoreProvider>
        </Html>
      </group>
    </Billboard>
  );
};
