import { create } from "zustand";

export const SIDEBAR_COLLAPSED_KEY = "hive-sidebar-collapsed";

interface SidebarState {
  collapsed: boolean;
  /** Read persisted state from localStorage (call in an effect to avoid hydration mismatch). */
  hydrate: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const persist = (collapsed: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage errors (private mode, etc.)
  }
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: false,
  hydrate: () => {
    try {
      set({ collapsed: localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true" });
    } catch {
      // ignore
    }
  },
  setCollapsed: (collapsed) => {
    persist(collapsed);
    set({ collapsed });
  },
  toggle: () => get().setCollapsed(!get().collapsed),
}));
