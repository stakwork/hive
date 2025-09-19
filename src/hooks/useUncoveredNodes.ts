import { useCallback, useEffect, useMemo, useState } from "react";
import { UncoveredItemsResponse, UncoveredNodeType, UncoveredNodeConcise } from "@/types/stakgraph";
import { useWorkspace } from "@/hooks/useWorkspace";

export interface UseUncoveredParams {
  nodeType?: UncoveredNodeType;
  tests?: "untested" | "tested" | "all";
  limit?: number;
  offset?: number;
  sort?: string;
  root?: string;
  concise?: boolean;
}

export function useUncoveredNodes(initial: UseUncoveredParams = {}) {
  const { id: workspaceId } = useWorkspace();

  const [nodeType, setNodeType] = useState<UncoveredNodeType>(initial.nodeType || "endpoint");
  const [tests, setTests] = useState<"unit" | "integration" | "e2e" | "all">("all");
  const [limit, setLimit] = useState<number>(initial.limit ?? 10);
  const [offset, setOffset] = useState<number>(initial.offset ?? 0);
  const [sort, setSort] = useState<string>(initial.sort || "usage");
  const [root, setRoot] = useState<string>(initial.root || "");
  const [concise, setConcise] = useState<boolean>(initial.concise ?? true);

  const [items, setItems] = useState<UncoveredNodeConcise[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({ nodeType, tests, limit, offset, sort, root, concise }),
    [nodeType, tests, limit, offset, sort, root, concise],
  );

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      qp.set("workspaceId", workspaceId);
      qp.set("node_type", nodeType);
      qp.set("tests", tests);
      qp.set("limit", String(limit));
      qp.set("offset", String(offset));
      qp.set("sort", sort);
      if (root) qp.set("root", root);
      qp.set("concise", String(concise));

      const res = await fetch(`/api/tests/uncovered?${qp.toString()}`);
      const json: UncoveredItemsResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch uncovered items");
      }
      setItems((json.data?.items as UncoveredNodeConcise[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch uncovered items");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, nodeType, tests, limit, offset, sort, root, concise]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setPage = useCallback(
    (page: number) => {
      const newOffset = Math.max(0, (page - 1) * limit);
      setOffset(newOffset);
    },
    [limit],
  );

  const page = useMemo(() => Math.floor(offset / limit) + 1, [offset, limit]);

  return {
    items,
    loading,
    error,
    params,
    page,
    setPage,
    setNodeType,
    setTests,
    setLimit,
    setOffset,
    setSort,
    setRoot,
    setConcise,
    refetch: fetchData,
  };
}
