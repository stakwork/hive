import { useMemo, useEffect, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoverageNodesResponse } from "@/types/stakgraph";
import { useCoverageStore } from "@/stores/useCoverageStore";

export type StatusFilter = "all" | "tested" | "untested";

export interface UseCoverageParams {
  root?: string;
  concise?: boolean;
}

export function useCoverageNodes() {
  const { id: workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { nodeType, sort, sortDirection, limit, offset, coverage, mocked, ignoreDirs, repo, unitGlob, integrationGlob, e2eGlob, search, setOffset, setNodeType, setSort, setSortDirection, toggleSort, setCoverage, setMocked, setIgnoreDirs, setRepo, setUnitGlob, setIntegrationGlob, setE2eGlob, setSearch } = useCoverageStore();
  const hasInitializedIgnoreDirs = useRef(false);
  const hasInitializedUnitGlob = useRef(false);
  const hasInitializedIntegrationGlob = useRef(false);
  const hasInitializedE2eGlob = useRef(false);

  const queryKey = useMemo(
    () => ["coverage-nodes", workspaceId, nodeType, sort, sortDirection, limit, offset, coverage, mocked, ignoreDirs, repo, unitGlob, integrationGlob, e2eGlob, search],
    [workspaceId, nodeType, sort, sortDirection, limit, offset, coverage, mocked, ignoreDirs, repo, unitGlob, integrationGlob, e2eGlob, search],
  );

  const query = useQuery<CoverageNodesResponse | null>({
    queryKey,
    enabled: Boolean(workspaceId),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!workspaceId) return null;
      
      // Route to mock endpoint for mock node type
      if (nodeType === "mock") {
        const mockParams = new URLSearchParams({
          workspaceId,
          limit: String(limit),
          offset: String(offset),
        });

        if (search) {
          mockParams.append("search", search);
        }

        if (mocked && mocked !== "all") {
          mockParams.append("mocked", mocked);
        }

        const response = await fetch(`/api/tests/mocks?${mockParams.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to fetch mock inventory");
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.message || "Failed to fetch mock inventory");
        }

        // Transform MockInventoryResponse to match CoverageNodesResponse structure
        const mockData = result.data as {
          items: Array<{
            name: string;
            ref_id: string;
            description: string;
            linked_files: string[];
            file_count: number;
            mocked: boolean;
          }>;
          total_count: number;
          total_returned: number;
        };

        return {
          success: true,
          data: {
            node_type: "mock",
            pageSize: limit,
            items: mockData.items.map((item) => ({
              name: item.name,
              file: item.description,
              ref_id: item.ref_id,
              test_count: item.file_count,
              weight: 0,
              covered: item.mocked,
              line_count: 0,
              body_length: 0,
              verb: undefined,
              description: item.description,
              mocked: item.mocked,
            })),
            total_count: mockData.total_count,
            total_returned: mockData.total_returned,
            page: Math.floor(offset / limit) + 1,
            total_pages: Math.ceil(mockData.total_count / limit),
            hasNextPage: offset + limit < mockData.total_count,
          },
          message: "Mock inventory retrieved successfully",
        };
      }
      
      const qp = new URLSearchParams();
      qp.set("workspaceId", workspaceId);
      qp.set("node_type", nodeType);
      qp.set("limit", String(limit));
      qp.set("offset", String(offset));
      qp.set("sort_direction", sortDirection);
      if (sort === "body_length") {
        qp.set("body_length", "true");
      } else if (sort === "line_count") {
        qp.set("line_count", "true");
      } else {
        qp.set("sort", sort);
      }
      if (coverage && coverage !== "all") qp.set("coverage", coverage);
      if (hasInitializedIgnoreDirs.current && ignoreDirs) qp.set("ignoreDirs", ignoreDirs);
      if (repo) qp.set("repo", repo);
      if (hasInitializedUnitGlob.current && unitGlob) qp.set("unitGlob", unitGlob);
      if (hasInitializedIntegrationGlob.current && integrationGlob) qp.set("integrationGlob", integrationGlob);
      if (hasInitializedE2eGlob.current && e2eGlob) qp.set("e2eGlob", e2eGlob);
      if (search) qp.set("search", search);
      const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
      const json: CoverageNodesResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to fetch coverage nodes");
      }
      return json;
    },
  });

  const hasNextPage = Boolean(query.data?.data?.hasNextPage);
  const hasPrevPage = offset > 0;

  useEffect(() => {
    if (!hasInitializedIgnoreDirs.current && query.data?.data?.ignoreDirs !== undefined) {
      const apiIgnoreDirs = query.data.data.ignoreDirs;
      setIgnoreDirs(apiIgnoreDirs);
      hasInitializedIgnoreDirs.current = true;
    }
  }, [query.data?.data?.ignoreDirs, setIgnoreDirs]);

  useEffect(() => {
    if (!hasInitializedUnitGlob.current && query.data?.data?.unitGlob !== undefined) {
      const apiUnitGlob = query.data.data.unitGlob;
      setUnitGlob(apiUnitGlob);
      hasInitializedUnitGlob.current = true;
    }
  }, [query.data?.data?.unitGlob, setUnitGlob]);

  useEffect(() => {
    if (!hasInitializedIntegrationGlob.current && query.data?.data?.integrationGlob !== undefined) {
      const apiIntegrationGlob = query.data.data.integrationGlob;
      setIntegrationGlob(apiIntegrationGlob);
      hasInitializedIntegrationGlob.current = true;
    }
  }, [query.data?.data?.integrationGlob, setIntegrationGlob]);

  useEffect(() => {
    if (!hasInitializedE2eGlob.current && query.data?.data?.e2eGlob !== undefined) {
      const apiE2eGlob = query.data.data.e2eGlob;
      setE2eGlob(apiE2eGlob);
      hasInitializedE2eGlob.current = true;
    }
  }, [query.data?.data?.e2eGlob, setE2eGlob]);

  const prefetch = async (targetPage: number) => {
    if (!workspaceId) return;
    const prefetchKey = [
      "coverage-nodes",
      workspaceId,
      nodeType,
      sort,
      sortDirection,
      limit,
      targetPage,
      coverage,
      mocked,
      ignoreDirs,
      repo,
      unitGlob,
      integrationGlob,
      e2eGlob,
      search,
    ];
    await queryClient.prefetchQuery({
      queryKey: prefetchKey,
      queryFn: async () => {
        const qp = new URLSearchParams();
        qp.set("workspaceId", workspaceId);
        qp.set("node_type", nodeType);
        qp.set("limit", String(limit));
        qp.set("offset", String(targetPage));
        qp.set("sort_direction", sortDirection);
        if (sort === "body_length") {
          qp.set("body_length", "true");
        } else if (sort === "line_count") {
          qp.set("line_count", "true");
        } else {
          qp.set("sort", sort);
        }
        if (coverage && coverage !== "all") qp.set("coverage", coverage);
        if (hasInitializedIgnoreDirs.current && ignoreDirs) qp.set("ignoreDirs", ignoreDirs);
        if (repo) qp.set("repo", repo);
        if (hasInitializedUnitGlob.current && unitGlob) qp.set("unitGlob", unitGlob);
        if (hasInitializedIntegrationGlob.current && integrationGlob) qp.set("integrationGlob", integrationGlob);
        if (hasInitializedE2eGlob.current && e2eGlob) qp.set("e2eGlob", e2eGlob);
        if (search) qp.set("search", search);
        const res = await fetch(`/api/tests/nodes?${qp.toString()}`);
        const json: CoverageNodesResponse = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to fetch coverage nodes");
        }
        return json;
      },
    });
  };

  return {
    items: query.data?.data?.items || [],
    loading: query.isLoading,
    filterLoading: query.isFetching && !query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    params: { nodeType, limit, offset, sort, sortDirection, coverage },
    page: query.data?.data?.page || 1,
    totalPages: query.data?.data?.total_pages,
    totalCount: query.data?.data?.total_count,
    totalReturned: query.data?.data?.total_returned,
    hasNextPage,
    hasPrevPage,
    setPage: (p: number) => setOffset(Math.max(0, (p - 1) * limit)),
    prefetchNext: () => prefetch(offset + limit),
    prefetchPrev: () => prefetch(Math.max(0, offset - limit)),
    setNodeType,
    setLimit: (n: number) => useCoverageStore.setState({ limit: n, offset: 0 }),
    setSort,
    setSortDirection,
    toggleSort,
    setCoverage,
    setMocked,
    mocked,
    ignoreDirs,
    setIgnoreDirs,
    repo,
    setRepo,
    unitGlob,
    setUnitGlob,
    integrationGlob,
    setIntegrationGlob,
    e2eGlob,
    setE2eGlob,
    search,
    setSearch,
    setRoot: () => {},
    setConcise: () => {},
    setStatus: () => {},
    refetch: () => query.refetch(),
  };
}
