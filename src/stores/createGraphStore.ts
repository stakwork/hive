import { NodeExtended } from '@Universe/types';
import { create } from "zustand";
import { createDataStore } from "./createDataStore";
import { type GraphStore, type GraphStyle, type HighlightChunk } from "./graphStore.types";

// Re-export types for backward compatibility
export type { GraphStyle, Neighbourhood, Position } from "./graphStore.types";

export const graphStyles: GraphStyle[] = ['sphere', 'force', 'split']

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
  | 'addHighlightChunk'
  | 'removeHighlightChunk'
  | 'clearWebhookHighlights'
  | 'setActiveFilterTab'
> = {
  data: null,
  selectionGraphData: { nodes: [], links: [] },
  disableCameraRotation: true,
  scrollEventsDisabled: false,
  graphRadius: 1500,
  selectionGraphRadius: 200,
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
  highlightTimestamp: null,
  activeFilterTab: 'all',
  webhookHighlightDepth: 0,
}

export const createGraphStore = (
  dataStore: ReturnType<typeof createDataStore>,
  simulationStore: any
) =>
  create<GraphStore>()((set, get) => ({
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
      const { nodesNormalized } = dataStore.getState() || {}

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
      const { nodesNormalized } = dataStore.getState() || {}

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

      const { simulation } = simulationStore.getState()

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
    setWebhookHighlightNodes: (nodeIds: string[], depth = 0) => set({
      webhookHighlightNodes: nodeIds,
      highlightTimestamp: Date.now(),
      webhookHighlightDepth: depth
    }),
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
  }));
