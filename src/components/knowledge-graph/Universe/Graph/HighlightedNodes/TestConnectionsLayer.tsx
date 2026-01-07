import { useWorkspace } from '@/hooks/useWorkspace'
import { useStoreId } from '@/stores/StoreProvider'
import { getStoreBundle } from '@/stores/createStoreFactory'
import { useDataStore, useSimulationStore } from '@/stores/useStores'
import type { NodeExtended } from '@Universe/types'
import { useFrame } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'


type TestConnectionsLayerProps = {
  enabled: boolean
  nodeType: string
  color: string
}

// Visual configuration constants
const NODE_SIZE = 50 // Size of test indicator nodes
const NODE_SCALE = 0.7 // Scale factor for test indicator nodes
const NODE_OPACITY = 0.8 // Opacity for test indicator nodes
const LINE_WIDTH = 0.1 // Width of test edge lines
const LINE_OPACITY = 0.3 // Opacity for test edge lines

// Color configuration
const TESTED_COLOR = '#10b981' // Green for tested nodes (default)
const UNTESTED_COLOR = '#fbbf24' // Yellow for untested nodes

export const TestConnectionsLayer = memo<TestConnectionsLayerProps>(
  ({ enabled, nodeType, color }) => {
    const nodesNormalized = useDataStore((s) => s.nodesNormalized)
    const dataInitial = useDataStore((s) => s.dataInitial)
    const simulation = useSimulationStore((s) => s.simulation)
    const addNewNode = useDataStore((s) => s.addNewNode)
    const storeId = useStoreId()
    const { id: workspaceId } = useWorkspace()

    // State to store test edges fetched separately
    const [testEdges, setTestEdges] = useState<Array<{ source: string; target: string }>>([])
    const [isLoadingEdges, setIsLoadingEdges] = useState(false)
    const [fetchedNodeTypes, setFetchedNodeTypes] = useState<Set<string>>(new Set())

    // Fetch test nodes and edges for the current node type
    const fetchTestData = useCallback(async () => {
      if (!enabled || !workspaceId) {
        setTestEdges([])
        return
      }

      // Skip if already fetched this node type
      if (fetchedNodeTypes.has(nodeType)) {
        return
      }

      try {
        setIsLoadingEdges(true)

        const depth = 1
        const limit = 5000
        const topNodeCount = 5000

        const nodeTypes = [nodeType]

        const endpoint =
          `/graph/search` +
          `?depth=${depth}` +
          `&limit=${limit}` +
          `&top_node_count=${topNodeCount}` +
          `&node_type=${encodeURIComponent(JSON.stringify(nodeTypes))}`

        const url =
          `/api/swarm/jarvis/nodes` +
          `?id=${workspaceId}` +
          `&endpoint=${encodeURIComponent(endpoint)}`

        console.log(`[TestConnectionsLayer] Fetching ${nodeType} nodes and edges from:`, url)

        const response = await fetch(url)

        if (!response.ok) {
          throw new Error(`Failed to fetch ${nodeType} data: ${response.statusText}`)
        }

        const result = await response.json()

        if (!result.success || !result.data) {
          throw new Error(`API returned unsuccessful response for ${nodeType} data`)
        }

        // Get both nodes and edges
        const nodes = (result.data.nodes || []).map((node: any) => ({
          ...node,
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
          edge_count: node.edge_count ?? 0,
        }))
        const edges = result.data.edges || []

        console.log(`[TestConnectionsLayer] Fetched ${nodes.length} ${nodeType} nodes, ${edges.length} edges`)

        // Add nodes to the graph (but not edges to avoid affecting simulation)
        addNewNode({ nodes, edges: [] })

        // Store edges separately for visualization
        setTestEdges(edges)

        // Mark this node type as fetched
        setFetchedNodeTypes(prev => new Set([...prev, nodeType]))
      } catch (error) {
        console.error(`[TestConnectionsLayer] Error fetching ${nodeType} data:`, error)
        setTestEdges([])
      } finally {
        setIsLoadingEdges(false)
      }
    }, [enabled, workspaceId, nodeType, fetchedNodeTypes, addNewNode])

    // Reset fetched node types when workspace changes
    useEffect(() => {
      setFetchedNodeTypes(new Set())
      setTestEdges([])
    }, [workspaceId])

    // Fetch test data when enabled/nodeType changes
    useEffect(() => {
      fetchTestData()
    }, [fetchTestData])

    // Find nodes that have connections to test nodes AND nodes that don't
    const { nodesWithTests, untestedNodes } = useMemo(() => {
      if (!enabled || isLoadingEdges) {
        return { nodesWithTests: [], untestedNodes: [] }
      }

      const nodeValues = dataInitial?.nodes || []
      const nodeIds = new Set(nodeValues.map((n) => n.ref_id))
      const nodesWithTestConnections = new Set<string>()

      // If we have test edges, find which nodes are connected
      if (testEdges.length) {
        testEdges.forEach((edge) => {
          const sourceId = edge.source
          const targetId = edge.target

          if (sourceId && targetId) {
            if (nodeIds.has(targetId)) nodesWithTestConnections.add(targetId)
            if (nodeIds.has(sourceId)) nodesWithTestConnections.add(sourceId)
          }
        })
      }

      // Get Function and File nodes for untested analysis
      const codeNodes = nodeValues.filter(
        (node) => node.node_type === 'Function' || node.node_type === 'File'
      )

      // Nodes that HAVE test connections
      const tested = nodeValues
        .filter((node) => nodesWithTestConnections.has(node.ref_id))
        .map((node) => ({
          originalNode: node,
          position: new THREE.Vector3(node.x || 0, node.y || 0, node.z || 0),
          hasTests: true
        }))

      // Function/File nodes that DON'T have test connections
      const untested = codeNodes
        .filter((node) => !nodesWithTestConnections.has(node.ref_id))
        .map((node) => ({
          originalNode: node,
          position: new THREE.Vector3(node.x || 0, node.y || 0, node.z || 0),
          hasTests: false
        }))

      return { nodesWithTests: tested, untestedNodes: untested }
    }, [enabled, isLoadingEdges, testEdges, dataInitial?.nodes])

    // Create shared geometry for both tested and untested nodes
    const nodeGeometry = useMemo(() => {
      if (!nodesWithTests.length && !untestedNodes.length) return null
      // Create a diamond/rhombus shape using OctahedronGeometry
      return new THREE.OctahedronGeometry(NODE_SIZE, 0) // Sharp edges
    }, [nodesWithTests.length, untestedNodes.length])

    // Create material for tested nodes
    const testedMaterial = useMemo(() => {
      if (!nodesWithTests.length) return null
      return new THREE.MeshBasicMaterial({
        color: new THREE.Color(color || TESTED_COLOR),
        transparent: true,
        opacity: NODE_OPACITY,
      })
    }, [nodesWithTests.length, color])

    // Create material for untested nodes
    const untestedMaterial = useMemo(() => {
      if (!untestedNodes.length) return null
      return new THREE.MeshBasicMaterial({
        color: new THREE.Color(UNTESTED_COLOR),
        transparent: true,
        opacity: NODE_OPACITY,
      })
    }, [untestedNodes.length])

    // Process edges to create connections for visualization
    const edgeConnections = useMemo(() => {
      if (!enabled || !testEdges.length) return []

      const nodeIds = new Set(dataInitial?.nodes?.map(n => n.ref_id) || [])
      const connections: Array<{ from: string; to: string }> = []

      testEdges.forEach(edge => {
        const sourceId = edge.source
        const targetId = edge.target

        // Only create connections between existing nodes in dataInitial
        if (sourceId && targetId && nodeIds.has(sourceId) && nodeIds.has(targetId)) {
          connections.push({ from: sourceId, to: targetId })
        }
      })

      return connections
    }, [enabled, testEdges, dataInitial?.nodes])

    // Create edge geometry for rendering lines
    const edgeGeometry = useMemo(() => {
      if (!edgeConnections.length) return null

      const edgeCount = edgeConnections.length
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
    }, [edgeConnections])

    // Create edge material
    const edgeMaterial = useMemo(() => {
      if (!edgeConnections.length) return null

      return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(color || TESTED_COLOR) },
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
    }, [edgeConnections.length, color])

    // Helper function to get current node position
    const getNodePosition = (nodeId: string): THREE.Vector3 | null => {
      const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()

      const normalized = nodePositionsNormalized.get(nodeId)
      if (normalized) return new THREE.Vector3(normalized.x, normalized.y, normalized.z)

      const node = nodesNormalized.get(nodeId) as NodeExtended | undefined
      if (node && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        return new THREE.Vector3(node.x, node.y, node.z)
      }

      if (simulation) {
        const simNode = simulation.nodes()?.find((n: NodeExtended) => n.ref_id === nodeId)
        if (simNode) return new THREE.Vector3(simNode.x, simNode.y, simNode.z)
      }
      return null
    }

    // Update edge positions on each frame
    useFrame(() => {
      if (!enabled || !edgeConnections.length || !edgeGeometry || !edgeMaterial) return

      const aStart = edgeGeometry.getAttribute('aStart') as THREE.BufferAttribute | undefined
      const aEnd = edgeGeometry.getAttribute('aEnd') as THREE.BufferAttribute | undefined
      if (!aStart || !aEnd) return

      const startArr = aStart.array as Float32Array
      const endArr = aEnd.array as Float32Array

      let updatedEdges = 0
      edgeConnections.forEach((connection, edgeIndex) => {
        const start = getNodePosition(connection.from)
        const end = getNodePosition(connection.to)
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
      edgeGeometry.computeBoundingSphere()
      edgeMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
    })

    if (!enabled || (nodesWithTests.length === 0 && edgeConnections.length === 0 && untestedNodes.length === 0)) return null

    return (
      <group name={`${nodeType}-test-layer`}>
        {/* Render edges */}
        {edgeGeometry && edgeMaterial && edgeConnections.length > 0 && (
          <mesh
            geometry={edgeGeometry}
            material={edgeMaterial}
            frustumCulled={false}
            name={`${nodeType}-edges`}
          />
        )}

        {/* Render tested nodes */}
        {nodesWithTests.map((nodeData) => {
          const currentPosition = getNodePosition(nodeData.originalNode.ref_id)
          if (!currentPosition) return null

          // Calculate offset position for the tested node indicator
          const testedPosition = new THREE.Vector3(
            currentPosition.x,
            currentPosition.y,
            currentPosition.z
          )

          return (
            <mesh
              key={`tested-${nodeData.originalNode.ref_id}`}
              geometry={nodeGeometry || undefined}
              material={testedMaterial || undefined}
              position={testedPosition}
              scale={NODE_SCALE}
            />
          )
        })}

        {/* Render untested nodes */}
        {untestedNodes.map((nodeData) => {
          const currentPosition = getNodePosition(nodeData.originalNode.ref_id)
          if (!currentPosition) return null

          // Calculate offset position for the untested node indicator
          const untestedPosition = new THREE.Vector3(
            currentPosition.x, // Offset to the left
            currentPosition.y,
            currentPosition.z
          )

          return (
            <mesh
              key={`untested-${nodeData.originalNode.ref_id}`}
              geometry={nodeGeometry || undefined}
              material={untestedMaterial || undefined}
              position={untestedPosition}
              scale={NODE_SCALE * 0.9} // Slightly smaller
            />
          )
        })}
      </group>
    )
  }
)

TestConnectionsLayer.displayName = 'TestConnectionsLayer'
