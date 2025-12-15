import { GraphData, Link, NodeExtended } from '@Universe/types'
import { create } from 'zustand'
import { useDataStore } from '../useDataStore'
import { useSimulationStore } from '../useSimulationStore'

export type Position = {
  x: number
  y: number
  z: number
}

export type Neighbourhood = {
  name: string
  ref_id: string
}

export type GraphStyle = 'sphere' | 'force' | 'split'

export const graphStyles: GraphStyle[] = ['sphere', 'force', 'split']

export type CameraPosition = {
  x: number
  y: number
  z: number
}

export type CameraTarget = {
  x: number
  y: number
  z: number
}

export type FilterTab = 'all' | 'code' | 'comms' | 'tasks' | 'concepts'

export type HighlightChunk = {
  chunkId: string
  title: string
  ref_ids: string[]
  timestamp: number
  sourceNodeRefId?: string
}

export type GraphCallout = {
  id: string
  title: string
  nodeRefId: string
  addedAt: number
}

export type TestLayerVisibility = {
  unitTests: boolean
  integrationTests: boolean
  e2eTests: boolean
}

export type GraphStore = {
  graphRadius: number
  neighbourhoods: Neighbourhood[]
  selectionGraphRadius: number
  data: { nodes: NodeExtended[]; links: Link[] } | null
  selectionGraphData: GraphData
  graphStyle: GraphStyle
  hoveredNode: NodeExtended | null
  selectedNodeTypes: string[]
  selectedNodeType: string
  selectedLinkTypes: string[]
  selectedNode: NodeExtended | null
  cameraFocusTrigger: boolean
  showSelectionGraph: boolean
  disableCameraRotation: boolean
  scrollEventsDisabled: boolean
  isHovering: boolean
  activeEdge: Link | null
  activeNode: NodeExtended | null
  highlightNodes: string[]
  selectionPath: string[]
  hoveredNodeSiblings: string[]
  selectedNodeSiblings: string[]
  searchQuery: string
  followersFilter: string
  isolatedView: string
  dateRangeFilter: string
  cameraPosition: CameraPosition | null
  cameraTarget: CameraTarget | null
  webhookHighlightNodes: string[]
  highlightChunks: HighlightChunk[]
  callouts: GraphCallout[]
  highlightTimestamp: number | null
  activeFilterTab: FilterTab
  webhookHighlightDepth: number
  testLayerVisibility: TestLayerVisibility
  testNodesFetched: Record<keyof TestLayerVisibility, boolean>
  setDisableCameraRotation: (rotation: boolean) => void
  setScrollEventsDisabled: (rotation: boolean) => void
  setData: (data: GraphData) => void
  setGraphStyle: (graphStyle: GraphStyle) => void
  setGraphRadius: (graphRadius: number) => void
  setSelectionGraphRadius: (graphRadius: number) => void
  setHoveredNode: (hoveredNode: NodeExtended | null) => void
  setSelectedNode: (selectedNode: NodeExtended | null) => void
  setActiveEdge: (edge: Link | null) => void
  setActiveNode: (activeNode: NodeExtended | null) => void
  setHighlightNodes: (highlightNodes: string[]) => void
  setCameraFocusTrigger: (_: boolean) => void
  setShowSelectionGraph: (_: boolean) => void
  setSelectionData: (data: GraphData) => void
  setIsHovering: (isHovering: boolean) => void
  addToSelectionPath: (id: string) => void
  setSearchQuery: (id: string) => void
  setSelectedNodeTypes: (type: string) => void
  setSelectedNodeType: (type: string) => void
  resetSelectedNodeTypes: () => void
  resetSelectedNodeType: () => void
  setSelectedLinkTypes: (type: string) => void
  resetSelectedLinkTypes: () => void
  setFollowersFilter: (filter: string) => void
  setDateRangeFilter: (filter: string) => void
  setIsolatedView: (isolatedView: string) => void
  setNeighbourhoods: (neighbourhoods: Neighbourhood[]) => void
  setCameraPosition: (position: CameraPosition | null) => void
  setCameraTarget: (target: CameraTarget | null) => void
  saveCameraState: (position: CameraPosition, target: CameraTarget) => void
  setWebhookHighlightNodes: (nodeIds: string[], depth?: number) => void
  addCallout: (title: string, nodeRefId: string, id?: string, addedAt?: number) => string
  removeCallout: (calloutId: string) => void
  pruneExpiredCallouts: (ttlMs?: number) => void
  clearCallouts: () => void
  addHighlightChunk: (title: string, ref_ids: string[], sourceNodeRefId?: string) => string
  removeHighlightChunk: (chunkId: string) => void
  clearWebhookHighlights: () => void
  setActiveFilterTab: (tab: FilterTab) => void
  setTestLayerVisibility: (updates: Partial<TestLayerVisibility>) => void
  setTestNodesFetched: (key: keyof TestLayerVisibility, fetched: boolean) => void
}

const defaultData: Omit<
  GraphStore,
  | 'setData'
  | 'setCameraAnimation'
  | 'setScrollEventsDisabled'
  | 'setDisableCameraRotation'
  | 'setHoveredNode'
  | 'setSelectedNode'
  | 'setActiveEdge'
  | 'setActiveNode'
  | 'setHighlightNodes'
  | 'setCameraFocusTrigger'
  | 'setGraphRadius'
  | 'setSelectionGraphRadius'
  | 'setGraphStyle'
  | 'setShowSelectionGraph'
  | 'setSelectionData'
  | 'setHideNodeDetails'
  | 'setIsHovering'
  | 'addToSelectionPath'
  | 'setSearchQuery'
  | 'setSelectedNodeTypes'
  | 'setSelectedNodeType'
  | 'resetSelectedNodeTypes'
  | 'resetSelectedNodeType'
  | 'setSelectedLinkTypes'
  | 'resetSelectedLinkTypes'
  | 'setNodesToHide'
  | 'setFollowersFilter'
  | 'setDateRangeFilter'
  | 'setIsolatedView'
  | 'setNeighbourhoods'
  | 'setCameraPosition'
  | 'setCameraTarget'
  | 'saveCameraState'
  | 'setWebhookHighlightNodes'
  | 'addCallout'
  | 'removeCallout'
  | 'pruneExpiredCallouts'
  | 'clearCallouts'
  | 'addHighlightChunk'
  | 'removeHighlightChunk'
  | 'clearWebhookHighlights'
  | 'setActiveFilterTab'
  | 'setTestLayerVisibility'
  | 'setTestNodesFetched'
> = {
  data: null,
  selectionGraphData: { nodes: [], links: [] },
  disableCameraRotation: true,
  scrollEventsDisabled: false,
  graphRadius: 1500, // calculated from initial load
  selectionGraphRadius: 200, // calculated from initial load
  graphStyle: 'split',
  hoveredNode: null,
  hoveredNodeSiblings: [],
  selectedNodeSiblings: [],
  selectedNode: null,
  activeEdge: null,
  cameraFocusTrigger: false,
  showSelectionGraph: false,
  isHovering: false,
  selectionPath: [],
  activeNode: null,
  highlightNodes: [],
  searchQuery: '',
  selectedNodeTypes: [],
  selectedLinkTypes: [],
  followersFilter: '',
  dateRangeFilter: '',
  isolatedView: '',
  neighbourhoods: [],
  selectedNodeType: '',
  cameraPosition: null,
  cameraTarget: null,
  webhookHighlightNodes: [],
  highlightChunks: [],
  callouts: [],
  highlightTimestamp: null,
  activeFilterTab: 'all',
  webhookHighlightDepth: 0,
  testLayerVisibility: {
    unitTests: false,
    integrationTests: false,
    e2eTests: false,
  },
  testNodesFetched: {
    unitTests: false,
    integrationTests: false,
    e2eTests: false,
  },
}

export const useGraphStore = create<GraphStore>()((set, get) => {
  return {
    ...defaultData,
    setData: (data) => {
      set({ data })
    },
    setSelectedNodeTypes: (nodeType: string) => {
      const { selectedNodeTypes } = get()

      const updatedTypes = selectedNodeTypes.includes(nodeType)
        ? selectedNodeTypes.filter((i) => i !== nodeType)
        : [...selectedNodeTypes, nodeType]

      set({ selectedNodeTypes: updatedTypes })
    },
    setSelectedLinkTypes: (linkType: string) => {
      const { selectedLinkTypes } = get()

      const updatedTypes = selectedLinkTypes.includes(linkType)
        ? selectedLinkTypes.filter((i) => i !== linkType)
        : [...selectedLinkTypes, linkType]

      set({ selectedLinkTypes: updatedTypes })
    },
    setSelectedNodeType: (selectedNodeType) => set({ selectedNodeType }),
    resetSelectedNodeType: () => set({ selectedNodeType: '' }),
    resetSelectedNodeTypes: () => set({ selectedNodeTypes: [] }),
    resetSelectedLinkTypes: () => set({ selectedLinkTypes: [] }),
    setSelectionData: (selectionGraphData) => set({ selectionGraphData }),
    setScrollEventsDisabled: (scrollEventsDisabled) => set({ scrollEventsDisabled }),
    setDisableCameraRotation: (rotation) => set({ disableCameraRotation: rotation }),
    setIsHovering: (isHovering) => set({ isHovering }),
    setGraphRadius: (graphRadius) => set({ graphRadius }),
    setSelectionGraphRadius: (selectionGraphRadius) => set({ selectionGraphRadius }),
    setGraphStyle: (graphStyle) => set({ graphStyle }),
    setHoveredNode: (hoveredNode) => {
      const { nodesNormalized } = useDataStore.getState() || {}

      if (hoveredNode) {
        const normalizedNode = nodesNormalized.get(hoveredNode.ref_id)

        const siblings = [...(normalizedNode?.targets || []), ...(normalizedNode?.sources || [])]

        set({ hoveredNode, hoveredNodeSiblings: siblings })
      } else {
        set({ hoveredNode, hoveredNodeSiblings: [] })
      }
    },
    setActiveEdge: (activeEdge) => {
      set({ activeEdge })
    },
    setActiveNode: (activeNode) => {
      set({ activeNode })
    },
    setHighlightNodes: (highlightNodes) => {
      set({ highlightNodes })
    },
    addToSelectionPath: (id: string) => {
      const { selectionPath } = get()

      set({ selectionPath: [...selectionPath, id] })
    },
    setSelectedNode: (selectedNode) => {
      const { nodesNormalized } = useDataStore.getState() || {}

      if (!selectedNode) {
        set({
          hoveredNode: null,
          selectedNode: null,
          disableCameraRotation: false,
          showSelectionGraph: false,
          selectionPath: [],
          selectedNodeType: '',
        })
      }

      const { selectedNode: stateSelectedNode, selectionPath } = get()

      const { simulation } = useSimulationStore.getState()

      if (stateSelectedNode?.ref_id !== selectedNode?.ref_id) {
        const selectedNodeWithCoordinates =
          simulation?.nodes()?.find((i: NodeExtended) => i.ref_id === selectedNode?.ref_id) || null

        if (selectedNode?.ref_id && selectedNodeWithCoordinates) {
          const normalizedNode: NodeExtended | undefined = nodesNormalized?.get(selectedNode?.ref_id)

          set({
            hoveredNode: null,
            selectedNode: { ...selectedNodeWithCoordinates, ...(normalizedNode || {}), x: selectedNodeWithCoordinates.x, y: selectedNodeWithCoordinates.y, z: selectedNodeWithCoordinates.z },
            disableCameraRotation: true,
            selectionPath: [...selectionPath, selectedNodeWithCoordinates.ref_id],
            selectedNodeType: '',
            selectedNodeSiblings: [...(normalizedNode?.sources || []), ...(normalizedNode?.targets || [])],
          })
        }
      }
    },
    setCameraFocusTrigger: (cameraFocusTrigger) => set({ cameraFocusTrigger }),
    setShowSelectionGraph: (showSelectionGraph) => set({ showSelectionGraph }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setFollowersFilter: (filter) => set({ followersFilter: filter }),
    setDateRangeFilter: (filter) => set({ dateRangeFilter: filter }),
    setIsolatedView: (isolatedView) => set({ isolatedView }),
    setNeighbourhoods: (neighbourhoods) => set({ neighbourhoods }),
    setCameraPosition: (cameraPosition) => set({ cameraPosition }),
    setCameraTarget: (cameraTarget) => set({ cameraTarget }),
    saveCameraState: (position, target) => set({
      cameraPosition: position,
      cameraTarget: target
    }),
    setWebhookHighlightNodes: (nodeIds: string[], depth = 1) => set({
      webhookHighlightNodes: nodeIds,
      highlightTimestamp: Date.now(),
      webhookHighlightDepth: depth
    }),
    addCallout: (title: string, nodeRefId: string, id?: string, addedAt?: number) => {
      const calloutId = id || crypto.randomUUID()
      const { callouts } = get()
      const addedTimestamp = addedAt || Date.now()
      const nextCallouts: GraphCallout[] = [
        ...callouts.filter((callout) => callout.id !== calloutId),
        { id: calloutId, title, nodeRefId, addedAt: addedTimestamp }
      ]
      set({ callouts: nextCallouts })
      return calloutId
    },
    removeCallout: (calloutId: string) => {
      const { callouts } = get()
      const updated = callouts.filter((callout) => callout.id !== calloutId)
      set({ callouts: updated })
    },
    pruneExpiredCallouts: (ttlMs = 15 * 60 * 1000) => {
      const { callouts } = get()
      if (!callouts.length) return
      const now = Date.now()
      const fresh = callouts.filter((callout) => now - callout.addedAt < ttlMs)
      if (fresh.length !== callouts.length) {
        set({ callouts: fresh })
      }
    },
    clearCallouts: () => set({ callouts: [] }),
    addHighlightChunk: (title: string, ref_ids: string[], sourceNodeRefId?: string) => {
      const chunkId = crypto.randomUUID()
      const chunk: HighlightChunk = {
        chunkId,
        title,
        ref_ids,
        sourceNodeRefId,
        timestamp: Date.now()
      }
      const { highlightChunks } = get()
      set({
        highlightChunks: [...highlightChunks, chunk],
        highlightTimestamp: Date.now()
      })
      return chunkId
    },
    removeHighlightChunk: (chunkId: string) => {
      const { highlightChunks } = get()
      const updatedChunks = highlightChunks.filter(chunk => chunk.chunkId !== chunkId)
      set({
        highlightChunks: updatedChunks,
        highlightTimestamp: updatedChunks.length > 0 ? Date.now() : null
      })
    },
    clearWebhookHighlights: () => set({
      webhookHighlightNodes: [],
      highlightChunks: [],
      highlightTimestamp: null
    }),
    setActiveFilterTab: (activeFilterTab) => set({ activeFilterTab }),
    setTestLayerVisibility: (updates) => set(({ testLayerVisibility }) => ({
      testLayerVisibility: { ...testLayerVisibility, ...updates }
    })),
    setTestNodesFetched: (key, fetched) => set(({ testNodesFetched }) => ({
      testNodesFetched: { ...testNodesFetched, [key]: fetched }
    })),
  }
})

export const useSelectedNode = () => useGraphStore((s) => s.selectedNode)
export const useHoveredNode = () => useGraphStore((s) => s.hoveredNode)

export const useSelectedNodeRelativeIds = () => {
  const selectedNode = useGraphStore((s) => s.selectedNode)

  if (!selectedNode) {
    return []
  }

  const { dataInitial } = useDataStore.getState()

  const links = dataInitial?.links || []

  const relativeIds = links.reduce<string[]>((acc, curr) => {
    if (curr.source === selectedNode?.ref_id) {
      acc.push(curr.target)
    }

    if (curr.target === selectedNode?.ref_id) {
      acc.push(curr.source)
    }

    return acc
  }, [])

  return relativeIds
}
