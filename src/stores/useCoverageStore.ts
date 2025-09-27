import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { UncoveredNodeType } from "@/types/stakgraph";

type StatusFilter = "all" | "tested" | "untested";

type CoverageStore = {
  nodeType: UncoveredNodeType;
  status: StatusFilter;
  sort: string;
  pageSize: number;
  page: number;
  root: string;
  concise: boolean;
  setNodeType: (t: UncoveredNodeType) => void;
  setStatus: (s: StatusFilter) => void;
  setSort: (s: string) => void;
  setPageSize: (n: number) => void;
  setPage: (n: number) => void;
  setRoot: (v: string) => void;
  setConcise: (v: boolean) => void;
  resetPage: () => void;
};

export const useCoverageStore = create<CoverageStore>()(
  devtools((set) => ({
    nodeType: "endpoint",
    status: "all",
    sort: "usage",
    pageSize: 10,
    page: 1,
    root: "",
    concise: true,
    setNodeType: (t) => set({ nodeType: t, page: 1 }),
    setStatus: (s) => set({ status: s, page: 1 }),
    setSort: (s) => set({ sort: s }),
    setPageSize: (n) => set({ pageSize: n, page: 1 }),
    setPage: (n) => set({ page: Math.max(1, n) }),
    setRoot: (v) => set({ root: v }),
    setConcise: (v) => set({ concise: v }),
    resetPage: () => set({ page: 1 }),
  })),
);
