import { useDataStore } from "@/stores/useStores";
import { Billboard, Text } from "@react-three/drei";
import { useMemo } from "react";

export const LayerLabels = () => {
  const nodeTypes = useDataStore((s) => s.nodeTypes);

  // Calculate Y positions for each node type using the same logic as grid calculation
  const nodeTypeLabels = useMemo(() => {
    return nodeTypes.map((nodeType) => {
      const typeIndex = nodeTypes.indexOf(nodeType) + 1;
      // Separate layers by 500 units on Y axis
      const yLayer = Math.floor(typeIndex / 2) * 500;
      const isEvenLayer = typeIndex % 2 === 0;
      const yOffset = isEvenLayer ? yLayer : -yLayer;

      const name = nodeType.replace(/_/g, " ");

      return {
        nodeType,
        name,
        yPosition: yOffset,
      };
    });
  }, [nodeTypes]);

  return (
    <group>
      {nodeTypeLabels.map(({ nodeType, name, yPosition }) => (
        <Billboard key={nodeType} position={[0, yPosition + 200, 0]}>
          {/* Simple rectangular border */}
          <lineLoop position={[0, 0, -0.1]}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[
                  new Float32Array([
                    -(name.length * 12.5 + 10),
                    -35,
                    0, // bottom-left
                    name.length * 12.5 + 10,
                    -35,
                    0, // bottom-right
                    name.length * 12.5 + 10,
                    35,
                    0, // top-right
                    -(name.length * 12.5 + 10),
                    35,
                    0, // top-left
                  ]),
                  3,
                ]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="grey" opacity={0.5} transparent />
          </lineLoop>
          <Text fontSize={35} color="grey" anchorX="center" anchorY="middle" position={[0, 0, 0]}>
            {name}
          </Text>
        </Billboard>
      ))}
    </group>
  );
};
