import { MathUtils } from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'

import { useControlStore } from '@/stores/useControlStore'
import { useGraphStore, useSelectedNode } from '@/stores/useGraphStore'
import { initialCameraPosition } from './constants'
import { useAutoNavigate } from './useAutoNavigate'

const autoRotateSpeed = 1

let cameraAnimation: gsap.core.Tween | null = null

export const useCameraAnimations = ({ enabled, enableRotation }: { enabled: boolean; enableRotation: boolean }) => {
  const selectedNode = useSelectedNode()
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)
  const setDisableCameraRotation = useGraphStore((s) => s.setDisableCameraRotation)

  const cameraFocusTrigger = useGraphStore((s) => s.cameraFocusTrigger)

  useAutoNavigate()

  const graphRadius = useGraphStore((s) => s.graphRadius)

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

  useEffect(() => {
    console.log('updateGraphRadius', graphRadius)

    if (!selectedNode && cameraControlsRef) {
      cameraControlsRef.setLookAt(initialCameraPosition.x, initialCameraPosition.y, graphRadius + 200, 0, 0, 0, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, graphRadius, cameraFocusTrigger])

  // Camera rotation using useFrame
  useFrame((_, delta) => {
    if (cameraControlsRef) {
      // Get current state
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
