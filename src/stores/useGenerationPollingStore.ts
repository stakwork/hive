import { create } from "zustand";

export type PendingGeneration = {
  featureId: string;
  workspaceId: string;
  requestId: string;
  fieldName: "architecture" | "requirements";
  startedAt: Date;
};

export type CompletedGeneration = {
  featureId: string;
  fieldName: string;
  result: string;
  completedAt: Date;
};

interface GenerationPollingStore {
  pendingGenerations: PendingGeneration[];
  completedGenerations: CompletedGeneration[];
  isPolling: boolean;
  pollingIntervalId: NodeJS.Timeout | null;

  // Add a generation to poll
  addGeneration: (generation: Omit<PendingGeneration, "startedAt">) => void;

  // Remove a generation from polling
  removeGeneration: (featureId: string, fieldName: string) => void;

  // Clear a completed generation notification
  clearCompleted: (featureId: string, fieldName: string) => void;

  // Start the polling interval
  startPolling: () => void;

  // Stop the polling interval
  stopPolling: () => void;

  // Poll a single generation and update if completed
  pollAndUpdate: (generation: PendingGeneration) => Promise<void>;
}

export const useGenerationPollingStore = create<GenerationPollingStore>((set, get) => ({
  pendingGenerations: [],
  completedGenerations: [],
  isPolling: false,
  pollingIntervalId: null,

  addGeneration: (generation) => {
    // Check if this generation already exists (prevent duplicates)
    const existing = get().pendingGenerations.some(
      (gen) => gen.featureId === generation.featureId && gen.fieldName === generation.fieldName
    );

    if (existing) {
      return; // Already polling this generation
    }

    const pendingGen: PendingGeneration = {
      ...generation,
      startedAt: new Date(),
    };

    set((state) => ({
      pendingGenerations: [...state.pendingGenerations, pendingGen],
    }));

    // Auto-start polling if not already running
    if (!get().isPolling) {
      get().startPolling();
    }
  },

  removeGeneration: (featureId, fieldName) => {
    set((state) => ({
      pendingGenerations: state.pendingGenerations.filter(
        (gen) => !(gen.featureId === featureId && gen.fieldName === fieldName)
      ),
    }));

    // Stop polling if no more pending generations
    if (get().pendingGenerations.length === 0) {
      get().stopPolling();
    }
  },

  clearCompleted: (featureId, fieldName) => {
    set((state) => ({
      completedGenerations: state.completedGenerations.filter(
        (gen) => !(gen.featureId === featureId && gen.fieldName === fieldName)
      ),
    }));
  },

  startPolling: () => {
    if (get().isPolling) return;

    const intervalId = setInterval(() => {
      const pending = get().pendingGenerations;
      pending.forEach((gen) => {
        get().pollAndUpdate(gen);
      });
    }, 3000); // Poll every 3 seconds

    set({ isPolling: true, pollingIntervalId: intervalId });
  },

  stopPolling: () => {
    const { pollingIntervalId } = get();
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
    }
    set({ isPolling: false, pollingIntervalId: null });
  },

  pollAndUpdate: async (generation) => {
    try {
      // Poll generic swarm status endpoint
      const pollUrl = `/api/swarm/status?workspace_id=${generation.workspaceId}&request_id=${generation.requestId}`;
      const response = await fetch(pollUrl);

      if (!response.ok) {
        console.error("Polling failed:", response.status);
        return;
      }

      const data = await response.json();

      if (data.status === "completed") {
        const finalAnswer = data.result?.final_answer;

        if (finalAnswer) {
          // PATCH the feature with the result
          await fetch(`/api/features/${generation.featureId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              [generation.fieldName]: finalAnswer,
              [`${generation.fieldName}RequestId`]: null, // Clear the request ID
            }),
          });

          // Add to completed generations array
          set((state) => ({
            completedGenerations: [
              ...state.completedGenerations,
              {
                featureId: generation.featureId,
                fieldName: generation.fieldName,
                result: finalAnswer,
                completedAt: new Date(),
              },
            ],
          }));

          // Remove from polling queue
          get().removeGeneration(generation.featureId, generation.fieldName);
        }
      } else if (data.status === "failed") {
        console.error("Generation failed:", data.error);
        // Remove from polling queue
        get().removeGeneration(generation.featureId, generation.fieldName);
      }
      // If status is "pending", keep polling (do nothing)
    } catch (error) {
      console.error("Error polling generation:", error);
      // Don't remove from queue - keep retrying
    }
  },
}));
