import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { UncoveredNodeType } from "@/types/stakgraph";

export type CoverageSortOption = "test_count" | "name" | "body_length" | "line_count";
export type SortDirection = "asc" | "desc";

export type IgnoredFilter = "all" | "ignored" | "not_ignored";

type CoverageStore = {
  nodeType: UncoveredNodeType;
  sort: CoverageSortOption;
  sortDirection: SortDirection;
  limit: number;
  offset: number;
  coverage: "all" | "tested" | "untested";
  mocked: "all" | "mocked" | "unmocked";
  ignored: IgnoredFilter;
  ignoreDirs: string;
  statsRepo: string;
  nodesRepo: string;
  unitGlob: string;
  integrationGlob: string;
  e2eGlob: string;
  search: string;
  setNodeType: (t: UncoveredNodeType) => void;
  setSort: (s: CoverageSortOption) => void;
  setSortDirection: (d: SortDirection) => void;
  toggleSort: (s: CoverageSortOption) => void;
  setLimit: (n: number) => void;
  setOffset: (n: number) => void;
  setCoverage: (c: "all" | "tested" | "untested") => void;
  setMocked: (m: "all" | "mocked" | "unmocked") => void;
  setIgnored: (i: IgnoredFilter) => void;
  setIgnoreDirs: (dirs: string) => void;
  setStatsRepo: (repo: string) => void;
  setNodesRepo: (repo: string) => void;
  setUnitGlob: (glob: string) => void;
  setIntegrationGlob: (glob: string) => void;
  setE2eGlob: (glob: string) => void;
  setSearch: (search: string) => void;
  resetPagination: () => void;
};

export const useCoverageStore = create<CoverageStore>()(
  devtools((set, get) => ({
    nodeType: "endpoint",
    sort: "test_count",
    sortDirection: "desc",
    limit: 10,
    offset: 0,
    coverage: "all",
    mocked: "all",
    ignored: "all",
    ignoreDirs: "",
    statsRepo: "",
    nodesRepo: "",
    unitGlob: "",
    integrationGlob: "",
    e2eGlob: "",
    search: "",
    setNodeType: (t) => set({ nodeType: t, offset: 0 }),
    setSort: (s) => set({ sort: s, offset: 0 }),
    setSortDirection: (d) => set({ sortDirection: d, offset: 0 }),
    toggleSort: (s) => {
      const { sort, sortDirection } = get();
      if (sort === s) {
        set({ sortDirection: sortDirection === "asc" ? "desc" : "asc", offset: 0 });
      } else {
        set({ sort: s, sortDirection: "desc", offset: 0 });
      }
    },
    setLimit: (n) => set({ limit: Math.max(1, Math.min(100, n)), offset: 0 }),
    setOffset: (n) => set({ offset: Math.max(0, n) }),
    setCoverage: (c) => set({ coverage: c, offset: 0 }),
    setMocked: (m) => set({ mocked: m, offset: 0 }),
    setIgnored: (i) => set({ ignored: i, offset: 0 }),
    setIgnoreDirs: (dirs) => set({ ignoreDirs: dirs, offset: 0 }),
    setStatsRepo: (repo) => set({ statsRepo: repo }),
    setNodesRepo: (repo) => set({ nodesRepo: repo, offset: 0 }),
    setUnitGlob: (glob) => set({ unitGlob: glob, offset: 0 }),
    setIntegrationGlob: (glob) => set({ integrationGlob: glob, offset: 0 }),
    setE2eGlob: (glob) => set({ e2eGlob: glob, offset: 0 }),
    setSearch: (search) => set({ search, offset: 0 }),
    resetPagination: () => set({ offset: 0 }),
  })),
);
