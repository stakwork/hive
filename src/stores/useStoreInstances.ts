import { useStore } from "zustand";
import { getStoreBundle } from "./createStoreFactory";

export function useDataStoreInstance<T>(id: string, selector: (s: any) => T) {
  return useStore(getStoreBundle(id).data, selector);
}

export function useGraphStoreInstance<T>(id: string, selector: (s: any) => T) {
  return useStore(getStoreBundle(id).graph, selector);
}

export function useSimulationStoreInstance<T>(id: string, selector: (s: any) => T) {
  return useStore(getStoreBundle(id).simulation, selector);
}