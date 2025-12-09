

import { Flex } from '@/components/common/Flex'
import { useControlStore } from '@/stores/useControlStore'
import { useDataStore, useGraphStore } from '@/stores/useStores'
import { AdaptiveDpr, AdaptiveEvents, Html, Loader, Preload } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, memo, useCallback } from 'react'
import { Controls } from './Controls'
import { initialCameraPosition } from './Controls/CameraAnimations/constants'
import { CursorTooltip } from './CursorTooltip'
import { Graph } from './Graph'
import { Overlay } from './Overlay'
import { colors } from './utils/colors'

const Fallback = () => (
  <Html>
    <Loader />
  </Html>
)

const Content = ({ enableRotation }: { enableRotation: boolean }) => {

  const dataInitial = useDataStore((s) => s.dataInitial)

  return (
    <>
      <color args={[colors.BLUE_PRESS_STATE]} attach="transparent" />

      <Controls enableRotation={enableRotation} />
      {/* <Perf
        position="top-left"
        showGraph={false}
        deepAnalyze={true}
        minimal={false}
        overClock={false}
        matrixUpdate={true}
        colorBlind={false}
        antialias={false}
      /> */}

      <Graph />
    </>
  )
}

let wheelEventTimeout: ReturnType<typeof setTimeout> | null = null

const UniverseComponent = ({ enableRotation = false }: { enableRotation?: boolean }) => {
  const [setIsUserScrollingOnHtmlPanel, setIsUserScrolling, setUserMovedCamera, setUserInteraction] = [
    useControlStore((s) => s.setIsUserScrollingOnHtmlPanel),
    useControlStore((s) => s.setIsUserScrolling),
    useControlStore((s) => s.setUserMovedCamera),
    useControlStore((s) => s.setUserInteraction),
  ]

  // Initialize webhook highlights listener
  // useWebhookHighlights()

  // Get saved camera position for initial canvas setup
  const { cameraPosition } = useGraphStore((s) => s)

  const cameraProps = {
    far: 30000,
    near: 1,
    position: cameraPosition ?
      [cameraPosition?.x, cameraPosition?.y, cameraPosition?.z] as [number, number, number] :
      [initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z] as [number, number, number],
  } as const


  const onWheelHandler = useCallback(
    (e: React.WheelEvent) => {
      const { target } = e
      const { offsetParent } = target as HTMLDivElement

      if (wheelEventTimeout) {
        clearTimeout(wheelEventTimeout)
      }

      if (offsetParent?.classList?.contains('html-panel')) {
        // if overflowing on y, disable camera controls to scroll on div
        if (offsetParent.clientHeight < offsetParent.scrollHeight) {
          setIsUserScrollingOnHtmlPanel(true)
        }
      }

      setIsUserScrolling(true)
      setUserMovedCamera(true)
      setUserInteraction() // Track user interaction for 30-second timeout

      wheelEventTimeout = setTimeout(() => {
        setIsUserScrolling(false)
        setIsUserScrollingOnHtmlPanel(false)
      }, 200)
    },
    [setIsUserScrolling, setIsUserScrollingOnHtmlPanel, setUserMovedCamera, setUserInteraction],
  )


  return (
    <Flex style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Suspense fallback={null}>

        <Canvas
          camera={cameraProps}
          frameloop={'always'}
          id="universe-canvas"
          style={{ width: '100%', height: '100%' }}
          onCreated={() => console.log('onCreated')}
          onWheel={onWheelHandler}
        >
          <Suspense fallback={<Fallback />}>
            <Preload />

            <AdaptiveDpr />

            <AdaptiveEvents />

            <Content enableRotation={enableRotation} />
          </Suspense>
        </Canvas>
        <CursorTooltip />
      </Suspense>
      <Overlay />
    </Flex>
  )
}


export const Universe = memo(UniverseComponent)
