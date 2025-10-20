

import { Flex } from '@/components/common/Flex'
import { useControlStore } from '@/stores/useControlStore'
import { useDataStore } from '@/stores/useDataStore'
import { AdaptiveDpr, AdaptiveEvents, Html, Loader, Preload } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, memo, useCallback } from 'react'
import { Controls } from './Controls'
import { initialCameraPosition } from './Controls/CameraAnimations/constants'
import { CursorTooltip } from './CursorTooltip'
import { Graph } from './Graph'
import { GraphStyleSwitcher } from './Graph/UI/GraphStyleSwitcher'
import { GraphSearch } from './GraphSearch'
import { Overlay } from './Overlay'
import { colors } from './utils/colors'

const Fallback = () => (
  <Html>
    <Loader />
  </Html>
)

const Content = () => {

  const dataInitial = useDataStore((s) => s.dataInitial)

  return (
    <>
      <color args={[colors.BLUE_PRESS_STATE]} attach="transparent" />

      <Controls />

      <>{dataInitial?.nodes?.length ? <Graph /> : null}</>
    </>
  )
}

let wheelEventTimeout: ReturnType<typeof setTimeout> | null = null

const cameraProps = {
  aspect: window.innerWidth / window.innerHeight,
  far: 30000,
  near: 1,
  position: [initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z],
} as const

const _Universe = () => {
  const [setIsUserScrollingOnHtmlPanel, setIsUserScrolling, setUserMovedCamera] = [
    useControlStore((s) => s.setIsUserScrollingOnHtmlPanel),
    useControlStore((s) => s.setIsUserScrolling),
    useControlStore((s) => s.setUserMovedCamera),
  ]


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

      wheelEventTimeout = setTimeout(() => {
        setIsUserScrolling(false)
        setIsUserScrollingOnHtmlPanel(false)
      }, 200)
    },
    [setIsUserScrolling, setIsUserScrollingOnHtmlPanel, setUserMovedCamera],
  )


  return (
    <Flex style={{ width: '100%', height: '600px' }}>
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

            <Content />
          </Suspense>
        </Canvas>
        <GraphSearch />
        <CursorTooltip />
      </Suspense>
      <Overlay />
    </Flex>
  )
}


export const Universe = memo(_Universe)
