import { getStoreBundle } from '@/stores/createStoreFactory'
import { useStoreId } from '@/stores/StoreProvider'
import { useControlStore } from '@/stores/useControlStore'
import { useGraphStore, useSelectedNode } from '@/stores/useStores'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, Vector3 } from 'three'
import { initialCameraPosition } from './constants'
import { logger } from "@/lib/logger";


const autoRotateSpeed = 1

let cameraAnimation: gsap.core.Tween | null = null

export const useCameraAnimations = ({ enabled, enableRotation }: { enabled: boolean; enableRotation: boolean }) => {
  const selectedNode = useSelectedNode()
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)
  const setDisableCameraRotation = useGraphStore((s) => s.setDisableCameraRotation)
  const saveCameraState = useGraphStore((s) => s.saveCameraState)
  const storeId = useStoreId()

  const cameraFocusTrigger = useGraphStore((s) => s.cameraFocusTrigger)

  useAutoNavigate()

  const graphRadius = useGraphStore((s) => s.graphRadius)

  // Track if we've already attempted restoration this session
  const hasAttemptedRestoration = useRef(false)

  // Get simulation sleeping state
  const { isSleeping } = getStoreBundle(storeId).simulation.getState()

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
    return () => {
      if (cameraControlsRef) {
        try {
          const position = cameraControlsRef.getPosition(new Vector3())
          const target = cameraControlsRef.getTarget(new Vector3())

          const distance = Math.sqrt(
            Math.pow(position.x - target.x, 2) +
            Math.pow(position.y - target.y, 2) +
            Math.pow(position.z - target.z, 2)
          )

          console.log('🎥 SAVING CAMERA STATE ON UNMOUNT:')
          logger.debug("  📍 Position:", {  x: position.x.toFixed(1), y: position.y.toFixed(1), z: position.z.toFixed(1) })
          logger.debug("  🎯 Target:", {  x: target.x.toFixed(1), y: target.y.toFixed(1), z: target.z.toFixed(1) })
          logger.debug("  📏 Distance between position and target:", { distance: distance.toFixed(1) })

          if (distance < 100) {
            logger.warn("⚠️  WARNING: Camera position and target are very close! This might indicate an issue.")
          }

          saveCameraState(
            { x: position.x, y: position.y, z: position.z },
            { x: target.x, y: target.y, z: target.z }
          )
        } catch (error) {
          logger.warn("Failed to save camera state on unmount:", { error })
        }
      }
    }
  }, [cameraControlsRef, saveCameraState])

  useEffect(() => {
    // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
    logger.debug("Controls-CameraAnimations: cameraControlsRef", { debugId: cameraControlsRef?._debugId })
    logger.debug("CameraAnimations: isSleeping", { isSleeping, hasAttemptedRestoration: hasAttemptedRestoration.current })

    logger.debug("CameraAnimations: cameraFocusTrigger", { cameraFocusTrigger })
    if (!selectedNode && cameraControlsRef) {


      const { cameraPosition, cameraTarget } = getStoreBundle(storeId).graph.getState()
      const { isSleeping: wasSleeping } = getStoreBundle(storeId).simulation.getState()

      logger.debug("CameraAnimations: wasSleeping:", { wasSleeping, hasCamera: !!cameraPosition && !!cameraTarget })

      // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
      logger.debug("CameraAnimations: camerararef", { cameraControlsRef, camera: cameraControlsRef.camera, debugId: cameraControlsRef._debugId })

      // Only restore saved position if we were sleeping AND haven't already attempted restoration
      if (wasSleeping && cameraPosition && cameraTarget && !hasAttemptedRestoration.current) {
        logger.debug("CameraAnimations: Restoring saved position after sleep", { cameraPosition, cameraTarget })
        hasAttemptedRestoration.current = true

        setTimeout(() => {
          logger.debug("CameraAnimations: restoring after timeout 2", { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z })
          // cameraControlsRef.setLookAt(
          //   cameraPosition.x,
          //   cameraPosition.y,
          //   cameraPosition.z,
          //   0,
          //   0,
          //   0,
          //   true
          // )
          const randomId = Math.random().toString(36).slice(2, 6)
          // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
          cameraControlsRef._debugId = `cameraControlsRef_${randomId}`
          logger.debug("CameraAnimations: randomId", { randomId })
          logger.debug("Debug output", { initialCameraPosition })
          cameraControlsRef.setLookAt(2000, initialCameraPosition.y, 2000, 0, 0, 0, true)
        }, 10000)
      } else if (cameraControlsRef.camera) {

        // Set initial position for new sessions (no saved state)
        console.log('CameraAnimations: Setting initial position')
        hasAttemptedRestoration.current = true
        logger.debug("CameraAnimations: Setting initial position", { x: initialCameraPosition.x, y: initialCameraPosition.y, z: graphRadius + 200 })

        setTimeout(() => {
          // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
          logger.debug("CameraAnimations: cameraControlsRef._debugId", { _debugId: cameraControlsRef._debugId })

          const randomId = Math.random().toString(36).slice(2, 6)
          // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
          cameraControlsRef._debugId = `cameraControlsRef_${randomId}`
          logger.debug("CameraAnimations: randomId", { randomId })
          console.log('CameraAnimations: restoring after timeout')
          cameraControlsRef.setLookAt(initialCameraPosition.x, initialCameraPosition.y, graphRadius + 200, 0, 0, 0, true)
        }, 1000)
      }
      // If we have saved state but weren't sleeping, don't restore (stay where we are)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, graphRadius, cameraFocusTrigger, storeId])

  // Reset restoration flag when component unmounts (user navigates away)
  useEffect(() => {
    return () => {
      hasAttemptedRestoration.current = false
    }
  }, [])

  // Camera rotation using useFrame
  useFrame((_, delta) => {
    if (cameraControlsRef) {
      // Get current state
      const { disableCameraRotation } = getStoreBundle(storeId).graph.getState()
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
