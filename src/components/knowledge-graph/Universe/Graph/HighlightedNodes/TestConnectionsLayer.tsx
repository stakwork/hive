import { useStoreId } from '@/stores/StoreProvider'
import { getStoreBundle } from '@/stores/createStoreFactory'
import { useDataStore, useSimulationStore } from '@/stores/useStores'
import type { NodeExtended } from '@Universe/types'
import { useFrame } from '@react-three/fiber'
import { memo } from 'react'
import * as THREE from 'three'

type Connection = { from: string; to: string }

type TestConnectionsLayerProps = {
  enabled: boolean
  nodeType: string
  color: string
}

const LINE_OPACITY = 0.1
const LINE_WIDTH = 0.8

export const TestConnectionsLayer = memo<TestConnectionsLayerProps>(
  ({ enabled, nodeType, color }) => {
    const nodesNormalized = useDataStore((s) => s.nodesNormalized)
    const dataInitial = useDataStore((s) => s.dataInitial)
    const simulation = useSimulationStore((s) => s.simulation)
    const storeId = useStoreId()

    const connections: Connection[] = []
    if (enabled) {
      const nodeValues = dataInitial?.nodes || []
      const testNodes = nodeValues.filter(
        (node) => node.node_type?.toLowerCase() === nodeType.toLowerCase()
      )

      const targetNodes: NodeExtended[] = testNodes.map((node) => nodesNormalized.get(node.ref_id) || node).filter((node) => node !== undefined)


      if (targetNodes.length) {
        const nodeIds = new Set(nodeValues.map((n) => n.ref_id))
        const seen = new Set<string>()

        targetNodes.forEach((testNode) => {
          const neighbors = [...(testNode.sources || []), ...(testNode.targets || [])]

          neighbors.forEach((neighborId) => {
            if (!neighborId || neighborId === testNode.ref_id) return
            if (!nodeIds.has(neighborId)) return

            const pairKey = [testNode.ref_id, neighborId].sort().join('--')
            if (seen.has(pairKey)) return

            seen.add(pairKey)
            connections.push({ from: testNode.ref_id, to: neighborId })
          })
        })
      }
    }

    const edgeCount = enabled ? connections.length : 0

    // Allocate geometry once per render for simplicity (no memo)
    const geometry =
      edgeCount > 0
        ? (() => {
          const vCount = edgeCount * 4
          const iCount = edgeCount * 6

          const positions = new Float32Array(vCount * 3)
          const aStart = new Float32Array(vCount * 3)
          const aEnd = new Float32Array(vCount * 3)
          const aSide = new Float32Array(vCount)
          const aT = new Float32Array(vCount)
          const indices = new Uint32Array(iCount)

          for (let e = 0; e < edgeCount; e++) {
            const v = e * 4
            const i = e * 6

            aSide[v] = -1
            aSide[v + 1] = +1
            aSide[v + 2] = -1
            aSide[v + 3] = +1

            aT[v] = 0
            aT[v + 1] = 0
            aT[v + 2] = 1
            aT[v + 3] = 1

            indices[i] = v
            indices[i + 1] = v + 2
            indices[i + 2] = v + 1
            indices[i + 3] = v + 2
            indices[i + 4] = v + 3
            indices[i + 5] = v + 1
          }

          const geo = new THREE.BufferGeometry()
          geo.setIndex(new THREE.BufferAttribute(indices, 1))
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          geo.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3))
          geo.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 3))
          geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
          geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1))
          return geo
        })()
        : null

    const material =
      edgeCount > 0
        ? new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: {
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: LINE_OPACITY },
            uLineWidth: { value: LINE_WIDTH },
            uResolution: { value: new THREE.Vector2(1, 1) },
          },
          vertexShader: `
              uniform vec2 uResolution;
              uniform float uLineWidth;

              attribute vec3 aStart;
              attribute vec3 aEnd;
              attribute float aSide;
              attribute float aT;

              void main() {
                vec4 sc = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
                vec4 ec = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

                vec4 clip = mix(sc, ec, aT);

                vec2 sN = sc.xy / sc.w;
                vec2 eN = ec.xy / ec.w;
                vec2 dir = normalize(eN - sN);
                vec2 normal = vec2(-dir.y, dir.x);

                float aspect = uResolution.x / uResolution.y;
                normal.x *= aspect;

                vec2 offset = normal * aSide * uLineWidth / uResolution.y * 2.0;

                vec2 ndc = clip.xy / clip.w;
                ndc += offset;

                clip.xy = ndc * clip.w;
                gl_Position = clip;
              }
            `,
          fragmentShader: `
              uniform vec3 uColor;
              uniform float uOpacity;

              void main() {
                gl_FragColor = vec4(uColor, uOpacity);
              }
            `,
        })
        : null

    useFrame(() => {
      if (!enabled || !connections.length || !geometry || !material) return

      const aStart = geometry.getAttribute('aStart') as THREE.BufferAttribute | undefined
      const aEnd = geometry.getAttribute('aEnd') as THREE.BufferAttribute | undefined
      if (!aStart || !aEnd) return

      const startArr = aStart.array as Float32Array
      const endArr = aEnd.array as Float32Array
      const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()

      const getPos = (id: string): THREE.Vector3 | null => {
        const normalized = nodePositionsNormalized.get(id)
        if (normalized) return new THREE.Vector3(normalized.x, normalized.y, normalized.z)

        const node = nodesNormalized.get(id) as NodeExtended | undefined
        if (node && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
          return new THREE.Vector3(node.x, node.y, node.z)
        }

        if (simulation) {
          const simNode = simulation.nodes()?.find((n: NodeExtended) => n.ref_id === id)
          if (simNode) return new THREE.Vector3(simNode.x, simNode.y, simNode.z)
        }
        return null
      }

      let updatedEdges = 0
      connections.forEach((connection, edgeIndex) => {
        const start = getPos(connection.from)
        const end = getPos(connection.to)
        if (!start || !end) return

        const base = edgeIndex * 4
        for (let k = 0; k < 4; k++) {
          const idx = base + k
          startArr[idx * 3] = start.x
          startArr[idx * 3 + 1] = start.y
          startArr[idx * 3 + 2] = start.z

          endArr[idx * 3] = end.x
          endArr[idx * 3 + 1] = end.y
          endArr[idx * 3 + 2] = end.z
        }
        updatedEdges += 1
      })

      const usedVertices = updatedEdges * 4
      for (let i = usedVertices * 3; i < startArr.length; i++) {
        startArr[i] = 0
        endArr[i] = 0
      }

      aStart.needsUpdate = true
      aEnd.needsUpdate = true
      geometry.computeBoundingSphere()
      material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
    })

    if (!enabled || connections.length === 0) return null

    return (
      <group name={`${nodeType}-connections-layer`}>
        {geometry && material && (
          <mesh geometry={geometry} material={material} frustumCulled={false} />
        )}
      </group>
    )
  }
)

TestConnectionsLayer.displayName = 'TestConnectionsLayer'
