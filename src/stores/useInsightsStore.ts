import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface Recommendation {
  id: string;
  title: string;
  description: string;
  impact?: string;
  priority: string;
  createdAt?: string;
  janitorRun?: {
    id: string;
    janitorType: string;
    status: string;
    createdAt: string;
  };
}


const initialState = {
  recommendations: [],
  janitorConfig: null,
  loading: false,
  recommendationsLoading: false,
  showAll: false,
  runningJanitors: new Set<string>(),
  workspaceSlug: null as string | null,
  taskCoordinatorEnabled: false,
  recommendationSweepEnabled: false,
  ticketSweepEnabled: false,
};

type InsightsStore = {
  // State
  recommendations: Recommendation[];
  janitorConfig: Record<string, boolean> | null;
  loading: boolean;
  recommendationsLoading: boolean;
  showAll: boolean;
  runningJanitors: Set<string>;
  recommendationSweepEnabled: boolean;
  ticketSweepEnabled: boolean;
  workspaceSlug: string | null;

  // Actions
  fetchRecommendations: (slug: string) => Promise<void>;
  fetchJanitorConfig: (slug: string) => Promise<void>;
  toggleJanitor: (slug: string, configKey: string) => Promise<void>;
  toggleRecommendationSweep: (slug: string) => Promise<void>;
  toggleTicketSweep: (slug: string) => Promise<void>;
  runJanitor: (slug: string, janitorId: string) => Promise<void>;
  acceptRecommendation: (id: string) => Promise<any>;
  dismissRecommendation: (id: string) => Promise<void>;
  setShowAll: (show: boolean) => void;
  setWorkspaceSlug: (slug: string | null) => void;
  reset: () => void;
};

export const useInsightsStore = create<InsightsStore>()(
  devtools((set, get) => ({
    // Initial state
    ...initialState,

    // Fetch recommendations
    fetchRecommendations: async (slug: string) => {
      if (!slug) return;

      try {
        set({ recommendationsLoading: true, workspaceSlug: slug });
        const response = await fetch(`/api/workspaces/${slug}/janitors/recommendations?limit=10`);
        if (response.ok) {
          const data = await response.json();
          set({ recommendations: data.recommendations || [] });
        }
      } catch (error) {
        console.error("Error fetching recommendations:", error);
      } finally {
        set({ recommendationsLoading: false });
      }
    },

    // Fetch janitor config
    fetchJanitorConfig: async (slug: string) => {
      if (!slug) return;

      try {
        set({ loading: true });
        const response = await fetch(`/api/workspaces/${slug}/janitors/config`);
        if (response.ok) {
          const data = await response.json();
          set({
            janitorConfig: data.config,
            recommendationSweepEnabled: data.config.recommendationSweepEnabled || false,
            ticketSweepEnabled: data.config.ticketSweepEnabled || false
          });
        }
      } catch (error) {
        console.error("Error fetching janitor config:", error);
      } finally {
        set({ loading: false });
      }
    },

    // Toggle janitor
    toggleJanitor: async (slug: string, configKey: string) => {
      const state = get();
      if (!slug || !state.janitorConfig) return;

      try {
        const response = await fetch(`/api/workspaces/${slug}/janitors/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [configKey]: !state.janitorConfig[configKey]
          }),
        });

        if (response.ok) {
          const data = await response.json();
          set({
            janitorConfig: data.config,
            recommendationSweepEnabled: data.config.recommendationSweepEnabled || false,
            ticketSweepEnabled: data.config.ticketSweepEnabled || false
          });
        }
      } catch (error) {
        console.error("Error toggling janitor:", error);
        throw error;
      }
    },

    // Toggle Recommendation Sweep
    toggleRecommendationSweep: async (slug: string) => {
      const state = get();
      if (!slug) return;

      try {
        const response = await fetch(`/api/workspaces/${slug}/janitors/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recommendationSweepEnabled: !state.recommendationSweepEnabled
          }),
        });

        if (response.ok) {
          const data = await response.json();
          set({
            janitorConfig: data.config,
            recommendationSweepEnabled: data.config.recommendationSweepEnabled || false,
            ticketSweepEnabled: data.config.ticketSweepEnabled || false
          });
        }
      } catch (error) {
        console.error("Error toggling Recommendation Sweep:", error);
        throw error;
      }
    },

    // Toggle Ticket Sweep
    toggleTicketSweep: async (slug: string) => {
      const state = get();
      if (!slug) return;

      try {
        const response = await fetch(`/api/workspaces/${slug}/janitors/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketSweepEnabled: !state.ticketSweepEnabled
          }),
        });

        if (response.ok) {
          const data = await response.json();
          set({
            janitorConfig: data.config,
            recommendationSweepEnabled: data.config.recommendationSweepEnabled || false,
            ticketSweepEnabled: data.config.ticketSweepEnabled || false
          });
        }
      } catch (error) {
        console.error("Error toggling Ticket Sweep:", error);
        throw error;
      }
    },

    // Run janitor manually
    runJanitor: async (slug: string, janitorId: string) => {
      if (!slug) return;
      
      const state = get();
      try {
        // Add to running janitors
        set({
          runningJanitors: new Set([...state.runningJanitors, janitorId])
        });
        
        const response = await fetch(`/api/workspaces/${slug}/janitors/${janitorId}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        
        if (response.ok) {
          // Refresh recommendations after janitor run
          await get().fetchRecommendations(slug);
        } else {
          const error = await response.json();
          console.error("Janitor run failed:", error);
          throw new Error(error.error || 'Unknown error');
        }
      } catch (error) {
        console.error("Error running janitor:", error);
        throw error;
      } finally {
        // Remove from running janitors
        const currentState = get();
        const newRunningJanitors = new Set(currentState.runningJanitors);
        newRunningJanitors.delete(janitorId);
        set({ runningJanitors: newRunningJanitors });
      }
    },

    // Accept recommendation
    acceptRecommendation: async (id: string) => {
      try {
        const response = await fetch(`/api/janitors/recommendations/${id}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (response.ok) {
          const result = await response.json();
          // Re-fetch recommendations to get new ones
          const state = get();
          if (state.workspaceSlug) {
            await get().fetchRecommendations(state.workspaceSlug);
          }
          return result;
        } else {
          const error = await response.json();
          console.error("Accept failed:", error);
          throw new Error(error.error || "Unknown error");
        }
      } catch (error) {
        console.error("Error accepting recommendation:", error);
        throw error;
      }
    },

    // Dismiss recommendation
    dismissRecommendation: async (id: string) => {
      try {
        const response = await fetch(`/api/janitors/recommendations/${id}/dismiss`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (response.ok) {
          // Re-fetch recommendations to get new ones
          const state = get();
          if (state.workspaceSlug) {
            await get().fetchRecommendations(state.workspaceSlug);
          }
        } else {
          const error = await response.json();
          console.error("Dismiss failed:", error);
          throw new Error(error.error || "Unknown error");
        }
      } catch (error) {
        console.error("Error dismissing recommendation:", error);
        throw error;
      }
    },

    // Set show all recommendations
    setShowAll: (show: boolean) => set({ showAll: show }),

    // Set workspace slug
    setWorkspaceSlug: (slug: string | null) => set({ workspaceSlug: slug }),

    // Reset store
    reset: () => set(initialState),
  }))
);
