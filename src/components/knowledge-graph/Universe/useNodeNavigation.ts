import { useDataStore, useGraphStore } from "@/stores/useStores";

export const useNodeNavigation = () => {
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const nodesNormalized = useDataStore((state) => state.nodesNormalized);

  return {
    navigateToNode: (id: string) => {
      const node = nodesNormalized.get(id);
      if (node) {
        setSelectedNode(node);
      } else {
        setSelectedNode(null);
      }
    },
  };
};
