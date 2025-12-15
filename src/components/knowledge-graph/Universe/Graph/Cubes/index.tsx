import { useDataStore, useGraphStore, useHoveredNode, useSelectedNode } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { ThreeEvent } from '@react-three/fiber'
import { memo, useCallback, useRef } from 'react'
import { Group } from 'three'
import { useNodeNavigation } from '../../useNodeNavigation'
import { NodePoints } from './NodePoints'
import { RelevanceGroups } from './RelevanceGroups'
import { RelevanceList } from './RelevanceList/indes'

const POINTER_IN_DELAY = 100

export const Cubes = memo(() => {
  const selectedNode = useSelectedNode()
  const hoveredNode = useHoveredNode()
  const instancesRef = useRef<Group | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const downPosition = useRef<{ x: number; y: number } | null>(null)
  const upPosition = useRef<{ x: number; y: number } | null>(null)

  const { selectionGraphData, showSelectionGraph, setHoveredNode, setIsHovering } = useGraphStore((s) => s)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)

  const { navigateToNode } = useNodeNavigation()

  const ignoreNodeEvent = useCallback(
    (node: NodeExtended) => {
      if (showSelectionGraph && !selectionGraphData.nodes.find((n) => n.ref_id === node.ref_id)) {
        return false
      }

      return false
    },
    [showSelectionGraph, selectionGraphData],
  )

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    downPosition.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    upPosition.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleSelect = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()

      const object = e.intersections[0]?.object

      if (!object?.visible || !object.userData?.ref_id) {
        return
      }

      if (downPosition.current && upPosition.current) {
        const dx = upPosition.current.x - downPosition.current.x
        const dy = upPosition.current.y - downPosition.current.y
        const distance = Math.hypot(dx, dy)

        if (distance > 5) {
          return
        }
      }

      if (object?.userData && !ignoreNodeEvent(object.userData as NodeExtended)) {
        // Default behavior: show node details in the graph
        navigateToNode(object.userData.ref_id)
      }
    },
    [ignoreNodeEvent, navigateToNode],
  )

  const onPointerOut = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()



      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }

      if (!hoveredNode) {
        return
      }

      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovering(false)
        setHoveredNode(null)
      }, POINTER_IN_DELAY)
    },
    [setIsHovering, setHoveredNode, hoveredNode],
  )

  const onPointerIn = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const object = e.intersections[0]?.object

      if (!object?.visible || !object.userData?.ref_id) {
        return
      }

      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }

      const node = nodesNormalized.get(object.userData.ref_id)

      if (!node || ignoreNodeEvent(node)) {
        return
      }

      e.stopPropagation()

      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovering(true)
        setHoveredNode(node)
      }, POINTER_IN_DELAY)
    },
    [setHoveredNode, ignoreNodeEvent, setIsHovering, nodesNormalized],
  )

  return (
    <>
      <group
        onClick={handleSelect}
        onPointerDown={handlePointerDown}
        onPointerOut={onPointerOut}
        onPointerOver={onPointerIn}
        onPointerUp={handlePointerUp}
      >
        <group ref={instancesRef} name="simulation-3d-group__node-points">
          <NodePoints />
        </group>
      </group>
      {selectedNode && <RelevanceGroups />}
      {selectedNode && <RelevanceList />}
    </>
  )
})

Cubes.displayName = 'Cubes'
