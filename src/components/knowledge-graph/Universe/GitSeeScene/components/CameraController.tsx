import { useControlStore } from '@/stores/useControlStore';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type GitSeeDataPhase = 'loading' | 'repo-ready' | 'directories-ready' | 'files-ready' | 'complete';
interface CameraControllerProps {
  dataPhase: GitSeeDataPhase;
  gitseePosition: THREE.Vector3;
  cameraConfig: {
    initialFocusDistance: number;
    maxZoomOutDistance: number;
    orbitSpeed: number;
    radiusGrowthExponent: number;
    radiusGrowthMultiplier: number;
    heightVariationAmplitude: number;
    heightVariationSpeed: number;
  };
}

export const CameraController = ({
  dataPhase,
  gitseePosition,
  cameraConfig,
}: CameraControllerProps) => {
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef);

  // State for camera animation phases
  const [hasCameraFocused, setHasCameraFocused] = useState(false);
  const [cameraOrbitActive, setCameraOrbitActive] = useState(false);
  const [cameraDistancingActive, setCameraDistancingActive] = useState(false);

  // Timing refs
  const startTimeRef = useRef<number | null>(null);
  const repoFocusTimeRef = useRef<number | null>(null);

  // Focus camera as soon as controls are ready (even during loading)
  useEffect(() => {
    if (!hasCameraFocused && cameraControlsRef) {
      const targetPosition = new THREE.Vector3(
        gitseePosition.x,
        gitseePosition.y,
        gitseePosition.z + cameraConfig.initialFocusDistance
      );

      cameraControlsRef?.setLookAt(
        targetPosition.x,
        targetPosition.y,
        targetPosition.z,
        0,
        0,
        0,
        false
      );
      setHasCameraFocused(true);
      repoFocusTimeRef.current = Date.now();

      console.log('📷 Camera focused on GitSee scene (phase:', dataPhase, ')');
    }
  }, [dataPhase, hasCameraFocused, cameraControlsRef, gitseePosition, cameraConfig.initialFocusDistance]);

  // Start orbit immediately after the first focus
  useEffect(() => {
    if (hasCameraFocused && repoFocusTimeRef.current && !cameraOrbitActive) {
      setCameraOrbitActive(true);
      console.log('🌀 Camera orbit activated');
    }
  }, [hasCameraFocused, cameraOrbitActive]);

  // Begin zooming out only once directories are available
  useEffect(() => {
    const readyPhase = ['directories-ready', 'files-ready', 'complete'].includes(dataPhase);
    if (readyPhase && cameraOrbitActive && !cameraDistancingActive) {
      setCameraDistancingActive(true);
      console.log('↗️ Camera zoom-out activated (directories ready)');
    }
  }, [dataPhase, cameraOrbitActive, cameraDistancingActive]);

  // Camera animation frame
  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    if (!cameraOrbitActive || !cameraControlsRef || !repoFocusTimeRef.current) return;

    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const orbitTime = elapsed;

    // Start from the initial camera position and orbit
    const initialRadius = cameraConfig.initialFocusDistance;
    let currentRadius = initialRadius;

    if (cameraDistancingActive) {
      const radiusGrowth = Math.pow(orbitTime, cameraConfig.radiusGrowthExponent) * cameraConfig.radiusGrowthMultiplier;
      const targetRadius = initialRadius + radiusGrowth;
      currentRadius = Math.min(targetRadius, cameraConfig.maxZoomOutDistance);
    }

    // Height variation for more dynamic movement
    const heightVariation = Math.sin(orbitTime * cameraConfig.heightVariationSpeed) * cameraConfig.heightVariationAmplitude;

    // Orbital movement
    const angle = orbitTime * cameraConfig.orbitSpeed;
    const targetPos = new THREE.Vector3(0, 0, 0); // Look at center
    const cameraPos = new THREE.Vector3(
      Math.sin(angle) * currentRadius, // X position
      heightVariation, // Y position with variation
      Math.cos(angle) * currentRadius  // Z position
    );

    cameraControlsRef.setLookAt(
      cameraPos.x,
      cameraPos.y,
      cameraPos.z,
      targetPos.x,
      targetPos.y,
      targetPos.z,
      false // Don't animate, we're doing it manually
    );
  });

  // This component doesn't render anything, it just controls the camera
  return null;
};
