import { useControlStore } from '@/stores/useControlStore'
import { useGraphStore } from '@/stores/useStores'
import { CameraControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { useCameraAnimations } from './CameraAnimations'

type Props = {
  disableAnimations?: boolean
  enableRotation?: boolean
}

export const Controls = ({ disableAnimations, enableRotation = false }: Props) => {
  const { setDisableCameraRotation } = useGraphStore((s) => s)

  const isCameraControlsRefSet = useRef(false)

  const [smoothTime] = useState(0.8)




  const isUserScrolling = useControlStore((s) => s.isUserScrolling)
  const isUserDragging = useControlStore((s) => s.isUserDragging)
  const isUserScrollingOnHtmlPanel = useControlStore((s) => s.isUserScrollingOnHtmlPanel)
  const setCameraControlsRef = useControlStore((s) => s.setCameraControlsRef)
  const setIsUserDragging = useControlStore((s) => s.setIsUserDragging)
  const setUserInteraction = useControlStore((s) => s.setUserInteraction)

  useCameraAnimations({ enabled: !disableAnimations && !isUserScrolling && !isUserDragging, enableRotation })


  useEffect(() => {
    if (isUserDragging || isUserScrolling) {
      setDisableCameraRotation(true)
    }
  }, [isUserDragging, isUserScrolling, setDisableCameraRotation])


  return (
    <CameraControls
      ref={(ref) => {
        if (ref && !isCameraControlsRefSet.current) {
          isCameraControlsRefSet.current = true
          console.log('Controls: setting camera controls ref', ref)
          const randomId = Math.random().toString(36).slice(2, 6)
          // @ts-expect-error - this is a temporary fix to get the camera controls ref to work
          ref._debugId = `cameraControlsRefSetter_${randomId}`
          console.log('Controls-CameraAnimations: randomId', randomId)
          setCameraControlsRef(ref)
        }
      }}
      boundaryEnclosesCamera
      dollyToCursor
      enabled={!isUserScrollingOnHtmlPanel}
      makeDefault
      maxDistance={12000}
      minDistance={100}
      onEnd={() => {
        setIsUserDragging(false)
      }}
      onStart={() => {
        setIsUserDragging(true)
        setUserInteraction() // Track user interaction for 30-second timeout
      }}
      smoothTime={smoothTime}
    />
  )
}
