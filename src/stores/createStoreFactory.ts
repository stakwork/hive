import { createDataStore } from "./createDataStore";
import { createGraphStore } from "./createGraphStore";
import { createSimulationStore } from "./createSimulationStore";

type StoreBundle = {
  data: ReturnType<typeof createDataStore>;
  graph: ReturnType<typeof createGraphStore>;
  simulation: ReturnType<typeof createSimulationStore>;
};

const registry = new Map<string, StoreBundle>();

// Debug utilities
export function getStoreRegistryInfo() {
  const entries = Array.from(registry.entries()).map(([id, bundle]) => ({
    id,
    hasData: !!bundle.data,
    hasGraph: !!bundle.graph,
    hasSimulation: !!bundle.simulation,
    dataState: bundle.data.getState(),
    graphState: bundle.graph.getState(),
    simulationState: bundle.simulation.getState(),
  }));

  return {
    totalInstances: registry.size,
    storeIds: Array.from(registry.keys()),
    entries,
    registry: registry, // Raw registry for advanced debugging
  };
}

export function logStoreInstances() {
  const info = getStoreRegistryInfo();
  // console.log('=== STORE REGISTRY INFO ===');
  // console.log(`Total instances: ${info.totalInstances}`);
  // console.log('Store IDs:', info.storeIds);
  console.table(info.entries.map(entry => ({
    id: entry.id,
    hasStores: `${entry.hasData ? 'D' : ''}${entry.hasGraph ? 'G' : ''}${entry.hasSimulation ? 'S' : ''}`,
    dataNodes: entry.dataState?.dataInitial?.nodes?.length || 0,
    simulationNodes: entry.simulationState?.simulation?.nodes()?.length || 0,
    isSleeping: entry.simulationState?.isSleeping || false,
  })));
  return info;
}

export function getStoreBundle(id: string): StoreBundle {
  if (!registry.has(id)) {
    const data = createDataStore();

    // Create a lazy getter for graph store to handle circular dependency
     
    let graphStore: ReturnType<typeof createGraphStore>;
    const getGraphStore = () => graphStore;

    // Create simulation with lazy graph reference
    const simulation = createSimulationStore(data, {
      getState: () => getGraphStore().getState(),
      subscribe: () => () => {},
      destroy: () => {}
    });

    // Now create graph with simulation reference
    graphStore = createGraphStore(data, simulation);

    registry.set(id, { data, graph: graphStore, simulation });
  }
  return registry.get(id)!;
}

export function destroyStoreBundle(id: string) {
  registry.delete(id);
}