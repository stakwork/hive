import { NodeTypeOrderItem, sortNodeTypesByConfig } from "@/hooks/useSortedNodeTypes";
import { FilterParams, Link, Node, NodeExtended } from '@Universe/types';
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { type DataStore, defaultFilters } from "./useDataStore";

export type SidebarFilterWithCount = {
  name: string
  count: number
}

const repositoryNodeTypes = ['GitHubRepo', 'Commits', 'Stars', 'Issues', 'Age', 'Contributor'];

const defaultData: Omit<
  DataStore,
  | 'setTrendingTopics'
  | 'setStats'
  | 'setSidebarFilter'
  | 'setFilters'
  | 'setCategoryFilter'
  | 'setSelectedTimestamp'
  | 'setSources'
  | 'setSidebarFilterCounts'
  | 'setQueuedSources'
  | 'setHideNodeDetails'
  | 'addNewNode'
  | 'updateNode'
  | 'removeNode'
  | 'setAbortRequests'
  | 'resetDataNew'
  | 'setSeedQuestions'
  | 'setRunningProjectId'
  | 'setRunningProjectMessages'
  | 'resetRunningProjectMessages'
  | 'resetGraph'
  | 'resetData'
  | 'finishLoading'
  | 'setNodeTypeOrder'
  | 'setRepositoryNodes'
> = {
  categoryFilter: null,
  dataInitial: null,
  runningProjectMessages: [],
  filters: defaultFilters,
  repositoryNodes: [],
  queuedSources: null,
  selectedTimestamp: null,
  sources: null,
  sidebarFilter: 'all',
  sidebarFilters: [],
  trendingTopics: [],
  sidebarFilterCounts: [],
  stats: null,
  splashDataLoading: true,
  abortRequest: false,
  dataNew: null,
  seedQuestions: null,
  runningProjectId: '',
  hideNodeDetails: false,
  nodeTypes: [],
  linkTypes: [],
  nodesNormalized: new Map<string, NodeExtended>(),
  linksNormalized: new Map<string, Link>(),
  nodeLinksNormalized: {},
  nodeTypeOrder: null,
}

const normalizeNodeType = (type?: string) => (type || 'Unknown').trim()

export const createDataStore = () =>
  create<DataStore>()(
    devtools((set, get) => ({
      ...defaultData,

      addNewNode: (data) => {
        const {
          dataInitial: existingData,
          nodesNormalized,
          linksNormalized,
          nodeTypeOrder,
          nodeLinksNormalized: existingNodeLinksNormalized,
          repositoryNodes: existingRepositoryNodes,
        } = get()

        if (!data?.nodes) {
          return
        }

        const normalizedNodesMap = nodesNormalized || new Map()
        const normalizedLinksMap = linksNormalized || new Map()
        const nodeLinksNormalized: Record<string, string[]> = existingNodeLinksNormalized || {}


        // Separate repository nodes from regular graph nodes
        const repositoryNodes = data.nodes.filter((node) => repositoryNodeTypes.includes(node.node_type));
        const graphNodes = data.nodes.filter((node) => !repositoryNodeTypes.includes(node.node_type));

        const nodesFilteredByFilters = graphNodes.toSorted((a, b) => (a.date_added_to_graph || 0) - (b.date_added_to_graph || 0));
        const newNodes: Node[] = []

        nodesFilteredByFilters.forEach((node) => {
          if (!normalizedNodesMap.has(node.ref_id)) {
            normalizedNodesMap.set(node.ref_id, { ...node, sources: [], targets: [] })
            newNodes.push(node)
          }
        })

        const currentNodes = existingData?.nodes || []
        const updatedNodes = [...currentNodes, ...newNodes]

        const newLinks: Link[] = []
        const edges = data.edges || []

        edges.forEach((link: Link) => {
          if (
            !normalizedLinksMap.has(link.ref_id) &&
            normalizedNodesMap.has(link.source) &&
            normalizedNodesMap.has(link.target)
          ) {
            normalizedLinksMap.set(link.ref_id, link)
            newLinks.push(link)

            const sourceNode = normalizedNodesMap.get(link.source)
            const targetNode = normalizedNodesMap.get(link.target)

            if (sourceNode && targetNode) {
              sourceNode.targets = [...(sourceNode.targets || []), link.target]
              targetNode.sources = [...(targetNode.sources || []), link.source]

              sourceNode.edgeTypes = [...new Set([...(sourceNode.edgeTypes || []), link.edge_type])]
              targetNode.edgeTypes = [...new Set([...(targetNode.edgeTypes || []), link.edge_type])]
            }

            const pairKey = [link.source, link.target].sort().join('--')

            if (!nodeLinksNormalized[pairKey]) {
              nodeLinksNormalized[pairKey] = []
            }

            nodeLinksNormalized[pairKey].push(link.ref_id)
          }
        })

        const currentLinks = existingData?.links || []
        const updatedLinks = [...currentLinks, ...newLinks]

        const rawNodeTypes = [...new Set(updatedNodes.map((node) => normalizeNodeType(node.node_type)))]
        const nodeTypes = sortNodeTypesByConfig(rawNodeTypes, nodeTypeOrder)
        const linkTypes = [...new Set(updatedLinks.map((node) => node.edge_type))]
        const sidebarFilters = ['all', ...nodeTypes.map((type) => type.toLowerCase())]

        const updatedRepositoryNodes = [...existingRepositoryNodes];
        repositoryNodes.forEach((repoNode) => {
          if (!updatedRepositoryNodes.find(existing => existing.ref_id === repoNode.ref_id)) {
            updatedRepositoryNodes.push(repoNode);
          }
        });

        const sidebarFilterCounts = sidebarFilters.map((filter) => ({
          name: filter,
          count: updatedNodes.filter((node) => filter === 'all' || node.node_type?.toLowerCase() === filter).length,
        }))

        if (repositoryNodes.length) {
          set({ repositoryNodes: updatedRepositoryNodes })
        }

        if (!newNodes.length && !newLinks.length) {
          return
        }

        set({
          dataInitial: { nodes: updatedNodes, links: updatedLinks },
          dataNew: { nodes: newNodes, links: newLinks },
          nodeTypes,
          linkTypes,
          repositoryNodes: updatedRepositoryNodes,
          sidebarFilters,
          sidebarFilterCounts,
          nodesNormalized: normalizedNodesMap,
          linksNormalized: normalizedLinksMap,
          nodeLinksNormalized,
        })
      },

      resetGraph: () => {
        set({
          filters: defaultData.filters,
          dataInitial: null,
          dataNew: null,
        })
      },

      resetData: () => {
        set({
          dataInitial: null,
          sidebarFilter: 'all',
          sidebarFilters: [],
          sidebarFilterCounts: [],
          repositoryNodes: [],
          dataNew: null,
          runningProjectId: '',
          nodeTypes: [],
          nodesNormalized: new Map<string, NodeExtended>(),
          linksNormalized: new Map<string, Link>(),
          nodeLinksNormalized: {},
        })
      },

      resetDataNew: () => set({ dataNew: null }),
      setFilters: (filters: Partial<FilterParams>) => {
        set((state) => ({ filters: { ...state.filters, ...filters, skip: 0 } }))
      },
      setSidebarFilterCounts: (sidebarFilterCounts) => set({ sidebarFilterCounts }),
      setTrendingTopics: (trendingTopics) => set({ trendingTopics }),
      setStats: (stats) => set({ stats }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      setQueuedSources: (queuedSources) => set({ queuedSources }),
      setSidebarFilter: (sidebarFilter: string) => set({ sidebarFilter }),
      setSelectedTimestamp: (selectedTimestamp) => set({ selectedTimestamp }),
      setSources: (sources) => set({ sources }),
      setHideNodeDetails: (hideNodeDetails) => set({ hideNodeDetails }),
      setSeedQuestions: (questions) => set({ seedQuestions: questions }),
      updateNode: (updatedNode) => {
        const { nodesNormalized } = get()

        const newNodesNormalized = new Map(nodesNormalized)

        newNodesNormalized.set(updatedNode.ref_id, updatedNode)

        set({ nodesNormalized: newNodesNormalized })
      },

      removeNode: (id) => id,

      setRunningProjectId: (runningProjectId) => set({ runningProjectId, runningProjectMessages: [] }),
      setRunningProjectMessages: (message) => {
        const { runningProjectMessages } = get()

        set({ runningProjectMessages: [...runningProjectMessages, message] })
      },
      resetRunningProjectMessages: () => set({ runningProjectMessages: [] }),
      setAbortRequests: (abortRequest) => set({ abortRequest }),
      finishLoading: () => set({ splashDataLoading: false }),
      setNodeTypeOrder: (nodeTypeOrder: NodeTypeOrderItem[] | null) => {
        const { dataInitial } = get()

        set({ nodeTypeOrder })

        // Re-sort existing nodeTypes if we have data
        if (dataInitial?.nodes) {
          const rawNodeTypes = [...new Set(dataInitial.nodes.map((node) => normalizeNodeType(node.node_type)))]
          const sortedNodeTypes = sortNodeTypesByConfig(rawNodeTypes, nodeTypeOrder)
          const sidebarFilters = ['all', ...sortedNodeTypes.map((type) => type.toLowerCase())]

          set({
            nodeTypes: sortedNodeTypes,
            sidebarFilters
          })
        }
      },
      setRepositoryNodes: (repositoryNodes) => set({ repositoryNodes }),
    }))
  );


export const useRepositoryNodes = () => useDataStore((s) => s.repositoryNodes)
