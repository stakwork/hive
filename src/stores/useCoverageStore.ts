import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { UncoveredNodeType } from "@/types/stakgraph";

type CoverageStore = {
  nodeType: UncoveredNodeType;
  sort: string;
  limit: number;
  offset: number;
  coverage: "all" | "tested" | "untested";
  setNodeType: (t: UncoveredNodeType) => void;
  setSort: (s: string) => void;
  setLimit: (n: number) => void;
  setOffset: (n: number) => void;
  setCoverage: (c: "all" | "tested" | "untested") => void;
  resetPagination: () => void;
};

export const useCoverageStore = create<CoverageStore>()(
  devtools((set) => ({
    nodeType: "endpoint",
    sort: "test_count",
    limit: 10,
    offset: 0,
    coverage: "all",
    setNodeType: (t) => set({ nodeType: t, offset: 0 }),
    setSort: (s) => set({ sort: s }),
    setLimit: (n) => set({ limit: Math.max(1, Math.min(100, n)), offset: 0 }),
    setOffset: (n) => set({ offset: Math.max(0, n) }),
    setCoverage: (c) => set({ coverage: c, offset: 0 }),
    resetPagination: () => set({ offset: 0 }),
  })),
);
