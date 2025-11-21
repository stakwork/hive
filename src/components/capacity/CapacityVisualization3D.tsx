import { Canvas } from "@react-three/fiber";
import { Environment, CameraControls } from "@react-three/drei";
import { ServerModel } from "./ServerModel";
import { ServerParticles } from "./ServerParticles";
import { VMData } from "@/types/pool-manager";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import CameraCenterIcon from "@/components/Icons/CameraCenterIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CapacityVisualization3DProps {
  vmData: VMData[];
  onServerClick?: (vm: VMData) => void;
}

export interface CapacityVisualization3DRef {
  recenter: () => void;
}

// Constants for layout
const SERVER_HEIGHT = 0.6; // Vertical spacing between servers
const RACK_X_OFFSET = 2.5; // Offset from center for each column

export const CapacityVisualization3D = forwardRef<CapacityVisualization3DRef, CapacityVisualization3DProps>(
  ({ vmData, onServerClick }, ref) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const cameraControlsRef = useRef<CameraControls>(null);

    const handleRecenter = () => {
      setSelectedId(null);
      cameraControlsRef.current?.setLookAt(
        0,
        5,
        12, // Position: Centered, slightly up and back
        0,
        2,
        0, // Target: Center of the aisle
        true, // Transition: Smooth
      );
    };

    useImperativeHandle(ref, () => ({
      recenter: handleRecenter,
    }));

    // Initial camera position
    useEffect(() => {
      // Small delay to ensure controls are ready
      const timer = setTimeout(() => {
        handleRecenter();
      }, 100);
      return () => clearTimeout(timer);
    }, []);

    return (
      <div className="w-full h-[calc(100vh-12rem)] bg-black rounded-xl overflow-hidden border border-white/10 relative">
        <Canvas shadows camera={{ position: [0, 5, 12], fov: 45 }}>
          <CameraControls
            ref={cameraControlsRef}
            minPolarAngle={0}
            maxPolarAngle={Math.PI / 2} // Don't go below ground
            minDistance={2}
            maxDistance={20}
            dampingFactor={0.1}
          />
          {/* Industrial Warehouse Lighting */}
          <ambientLight intensity={0.4} color="#ffffff" /> {/* Brighter, neutral ambient */}
          {/* Overhead strip lights simulation */}
          <rectAreaLight
            width={20}
            height={2}
            color="#ffffff"
            intensity={2}
            position={[0, 10, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <rectAreaLight
            width={20}
            height={2}
            color="#ffffff"
            intensity={2}
            position={[0, 10, 10]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <rectAreaLight
            width={20}
            height={2}
            color="#ffffff"
            intensity={2}
            position={[0, 10, -10]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <spotLight
            position={[10, 20, 10]}
            angle={0.5}
            penumbra={0.5}
            intensity={1.0}
            castShadow
            color="#ffd7a8" // Warm industrial sodium light hint
          />
          <group position={[0, 0, 0]}>
            {vmData.map((vm, index) => {
              // Split into two columns: Left (Even indices) and Right (Odd indices)
              const isLeftColumn = index % 2 === 0;

              // Stack height index (0, 1, 2...) for each column
              const stackIndex = Math.floor(index / 2);

              // X position: Left or Right of aisle
              const x = isLeftColumn ? -RACK_X_OFFSET : RACK_X_OFFSET;

              // Y position: Vertical stack
              const y = stackIndex * SERVER_HEIGHT + 0.2;

              // Z position: Fixed at 0 (Single depth)
              const z = 0;

              const isSelected = selectedId === vm.id;

              return (
                <group key={vm.id}>
                  <ServerModel
                    position={[x, y, z]}
                    state={vm.state}
                    usageStatus={vm.usage_status}
                    cpuUsage={vm.resource_usage?.usage?.cpu}
                    memoryUsage={vm.resource_usage?.usage?.memory}
                    name={vm.id.substring(0, 8)}
                    subdomain={vm.subdomain}
                    userInfo={vm.user_info}
                    created={vm.created}
                    repoName={vm.repoName}
                    selected={isSelected}
                    onClick={() => {
                      setSelectedId(isSelected ? null : vm.id);
                      // Focus camera on selected server
                      if (!isSelected) {
                        cameraControlsRef.current?.setLookAt(
                          x + (isLeftColumn ? 4 : -4),
                          y + 1,
                          z + 6, // Camera position
                          x,
                          y,
                          z, // Target
                          true, // Transition
                        );
                      }
                      onServerClick?.(vm);
                    }}
                  />
                  {/* Particles positioned near the server face */}
                  <ServerParticles
                    position={[x, y, z + 1.5]}
                    active={vm.state?.toUpperCase() === "RUNNING"}
                    intensity={0.8}
                  />
                </group>
              );
            })}
          </group>
          <Environment preset="warehouse" environmentIntensity={0.7} />
          <fog attach="fog" args={["#1a1a1a", 10, 50]} />
        </Canvas>

        {/* Recenter Button */}
        <div className="absolute bottom-4 right-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRecenter}
                className="p-0 w-8 h-8 flex justify-center items-center bg-transparent border-none cursor-pointer hover:bg-black/10 rounded transition-colors"
              >
                <div className="brightness-[0.65]">
                  <CameraCenterIcon />
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Recenter</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  },
);

CapacityVisualization3D.displayName = "CapacityVisualization3D";
