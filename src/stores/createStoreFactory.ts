import { createDataStore } from "./createDataStore";
import { createGraphStore } from "./createGraphStore";
import { createSimulationStore } from "./createSimulationStore";

type StoreBundle = {
  data: ReturnType<typeof createDataStore>;
  graph: ReturnType<typeof createGraphStore>;
  simulation: ReturnType<typeof createSimulationStore>;
};

const registry = new Map<string, StoreBundle>();

export function getStoreBundle(id: string): StoreBundle {
  if (!registry.has(id)) {
    const data = createDataStore();
    // we create simulation and graph with mutual refs
    const simulation = createSimulationStore(data, null as any); // temporarily null
    const graph = createGraphStore(data, simulation);
    // patch back simulation reference (circular)
    (simulation as any).__graphStore = graph;
    registry.set(id, { data, graph, simulation });
  }
  return registry.get(id)!;
}

export function destroyStoreBundle(id: string) {
  registry.delete(id);
}