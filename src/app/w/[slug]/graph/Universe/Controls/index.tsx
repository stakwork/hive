import { useControlStore } from '@/stores/useControlStore'
import { useGraphStore } from '@/stores/useGraphStore'
import { CameraControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { useCameraAnimations } from './CameraAnimations'

type Props = {
  disableAnimations?: boolean
}

export const Controls = ({ disableAnimations }: Props) => {
  const { setDisableCameraRotation } = useGraphStore((s) => s)

  const isCameraControlsRefSet = useRef(false)

  const [smoothTime] = useState(0.8)



  const isUserScrolling = useControlStore((s) => s.isUserScrolling)
  const isUserDragging = useControlStore((s) => s.isUserDragging)
  const isUserScrollingOnHtmlPanel = useControlStore((s) => s.isUserScrollingOnHtmlPanel)
  const setCameraControlsRef = useControlStore((s) => s.setCameraControlsRef)
  const setIsUserDragging = useControlStore((s) => s.setIsUserDragging)

  useCameraAnimations({ enabled: !disableAnimations && !isUserScrolling && !isUserDragging })

  useEffect(() => {
    if (isUserDragging) {
      setDisableCameraRotation(true)
    }
  }, [isUserDragging, setDisableCameraRotation])

  return (
    <CameraControls
      ref={(ref) => {
        if (ref && !isCameraControlsRefSet.current) {
          isCameraControlsRefSet.current = true
          setCameraControlsRef(ref)
        }
      }}
      boundaryEnclosesCamera
      dollyToCursor
      enabled={!isUserScrollingOnHtmlPanel}
      makeDefault
      maxDistance={12000}
      minDistance={100}
      onEnd={() => setIsUserDragging(false)}
      onStart={() => setIsUserDragging(true)}
      smoothTime={smoothTime}
    />
  )
}
