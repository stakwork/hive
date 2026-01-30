import { GraphData, Link, NodeExtended } from '@Universe/types';

export type Position = { x: number; y: number; z: number }
export type Neighbourhood = { name: string; ref_id: string }
export type GraphStyle = 'sphere' | 'force' | 'split'
export type CameraPosition = { x: number; y: number; z: number }
export type CameraTarget = { x: number; y: number; z: number }

export type FilterTab = 'all' | 'code' | 'comms' | 'tasks' | 'concepts'

export type HighlightChunk = {
  chunkId: string
  title: string
  ref_ids: string[]
  sourceNodeRefId?: string
  timestamp: number
}

export type GraphCallout = {
  id: string
  title: string
  nodeRefId: string
  addedAt: number
  expiresAt?: number
  slot: number
}

export type TestLayerType = 'unitTests' | 'integrationTests' | 'e2eTests' | null

export type TestLayerVisibility = {
  selectedLayer: TestLayerType
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

  // setters
  setDisableCameraRotation(rotation: boolean): void
  setScrollEventsDisabled(rotation: boolean): void
  setData(data: GraphData): void
  setGraphStyle(graphStyle: GraphStyle): void
  setGraphRadius(graphRadius: number): void
  setSelectionGraphRadius(graphRadius: number): void
  setHoveredNode(hoveredNode: NodeExtended | null): void
  setSelectedNode(selectedNode: NodeExtended | null): void
  setActiveEdge(edge: Link | null): void
  setActiveNode(activeNode: NodeExtended | null): void
  setHighlightNodes(highlightNodes: string[]): void
  setCameraFocusTrigger(_: boolean): void
  setShowSelectionGraph(_: boolean): void
  setSelectionData(data: GraphData): void
  setIsHovering(isHovering: boolean): void
  addToSelectionPath(id: string): void
  setSearchQuery(id: string): void
  setSelectedNodeTypes(type: string): void
  setSelectedNodeType(type: string): void
  resetSelectedNodeTypes(): void
  resetSelectedNodeType(): void
  setSelectedLinkTypes(type: string): void
  resetSelectedLinkTypes(): void
  setFollowersFilter(filter: string): void
  setDateRangeFilter(filter: string): void
  setIsolatedView(isolatedView: string): void
  setNeighbourhoods(neighbourhoods: Neighbourhood[]): void
  setCameraPosition(position: CameraPosition | null): void
  setCameraTarget(target: CameraTarget | null): void
  saveCameraState(position: CameraPosition, target: CameraTarget): void
  setWebhookHighlightNodes(nodeIds: string[], depth?: number): void
  addCallout(title: string, nodeRefId: string, id?: string, addedAt?: number, expiresInMs?: number): string
  removeCallout(calloutId: string): void
  pruneExpiredCallouts(ttlMs?: number): void
  clearCallouts(): void
  addHighlightChunk(title: string, ref_ids: string[], sourceNodeRefId?: string): string
  removeHighlightChunk(chunkId: string): void
  clearWebhookHighlights(): void
  setActiveFilterTab(tab: FilterTab): void
  setTestLayerVisibility(layer: TestLayerType): void
}
