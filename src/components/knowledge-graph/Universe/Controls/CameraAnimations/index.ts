import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { MathUtils } from 'three'

import { useControlStore } from '@/stores/useControlStore'
import { useGraphStore, useSelectedNode } from '@/stores/useGraphStore'
import { useAutoNavigate } from './useAutoNavigate'

const autoRotateSpeed = 1

let cameraAnimation: gsap.core.Tween | null = null

export const useCameraAnimations = ({ enabled, enableRotation }: { enabled: boolean; enableRotation: boolean }) => {
  const selectedNode = useSelectedNode()
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)
  const setDisableCameraRotation = useGraphStore((s) => s.setDisableCameraRotation)
  const cameraFocusTrigger = useGraphStore((s) => s.cameraFocusTrigger)
  const graphRadius = useGraphStore((s) => s.graphRadius)

  useAutoNavigate()

  useEffect(() => {
    if (!enabled) {
      cameraAnimation?.kill()
      cameraAnimation = null
    }
  }, [enabled])

  // Enable rotation immediately when conditions are met
  useEffect(() => {
    if (enableRotation && graphRadius > 0) {
      setDisableCameraRotation(false)
    }
  }, [enableRotation, graphRadius, setDisableCameraRotation])

  // Camera positioning to frame the graph sphere
  useEffect(() => {
    console.log('updateGraphRadius', graphRadius)

    if (!selectedNode && cameraControlsRef && graphRadius > 0) {
      // Calculate camera distance to frame the graph sphere properly
      // Using camera's field of view (default ~75 degrees) and some padding
      const fov = 75 * (Math.PI / 180) // Convert to radians
      const paddingFactor = 1.5 // Add some padding around the sphere
      const distance = (graphRadius * paddingFactor) / Math.tan(fov / 2)

      // Position camera to look at the center of the graph sphere
      const cameraX = 0
      const cameraY = 0
      const cameraZ = distance
      const targetX = 0
      const targetY = 0
      const targetZ = 0

      console.log('Setting camera to frame graph sphere - distance:', distance, 'graphRadius:', graphRadius)
      cameraControlsRef.setLookAt(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, graphRadius, cameraFocusTrigger])

  // Camera rotation using useFrame
  useFrame((_, delta) => {
    if (cameraControlsRef) {
      // Get current state from singleton stores
      const { disableCameraRotation } = useGraphStore.getState()
      const { isUserDragging } = useControlStore.getState()

      // Do camera rotation if enabled and no user interaction
      if (enableRotation && !disableCameraRotation && !isUserDragging && !selectedNode) {
        cameraControlsRef.azimuthAngle += autoRotateSpeed * delta * MathUtils.DEG2RAD
      }

      cameraControlsRef.update(delta)
    }
  })

  return null
}
