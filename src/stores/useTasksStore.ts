import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface TasksStore {
  // Simple notification count by workspace
  waitingForInputCountByWorkspace: Record<string, number>;
  
  // Actions
  setWaitingForInputCount: (workspaceId: string, count: number) => void;
  getWaitingForInputCount: (workspaceId: string) => number;
}

export const useTasksStore = create<TasksStore>()(
  devtools(
    (set, get) => ({
      waitingForInputCountByWorkspace: {},

      setWaitingForInputCount: (workspaceId, count) =>
        set((state) => ({
          waitingForInputCountByWorkspace: {
            ...state.waitingForInputCountByWorkspace,
            [workspaceId]: count,
          },
        })),

      getWaitingForInputCount: (workspaceId) => {
        return get().waitingForInputCountByWorkspace[workspaceId] || 0;
      },
    }),
    { name: "tasks-store" }
  )
);

// Simple utility to update count from anywhere
export const updateWaitingForInputCount = (workspaceId: string, count: number) => {
  useTasksStore.getState().setWaitingForInputCount(workspaceId, count);
};