import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useInsightsStore } from "@/stores/useInsightsStore";

// Mock fetch globally
global.fetch = vi.fn();

const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("useInsightsStore - acceptRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state before each test
    useInsightsStore.getState().reset();
  });

  afterEach(() => {
    // Clean up store state after each test
    useInsightsStore.getState().reset();
  });

  describe("Successful Acceptance", () => {
    test("should accept recommendation and update state on success", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: {
          id: "task-456",
          title: "Fix bug in authentication",
          status: "OPEN",
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-01T00:00:00.000Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await useInsightsStore.getState().acceptRecommendation(recommendationId);

      // Verify API call was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      // Verify return value
      expect(result).toEqual(mockResponse);

      // Verify state update
      const state = useInsightsStore.getState();
      expect(state.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should add recommendation ID to dismissedSuggestions Set", async () => {
      const recommendationId = "rec-789";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test task" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      // Verify initial state
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(0);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      // Verify dismissedSuggestions was updated
      const state = useInsightsStore.getState();
      expect(state.dismissedSuggestions.size).toBe(1);
      expect(state.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle multiple recommendation acceptances", async () => {
      const rec1 = "rec-001";
      const rec2 = "rec-002";
      const rec3 = "rec-003";

      const mockResponse = (id: string) => ({
        success: true,
        task: { id: `task-${id}`, title: `Task ${id}` },
        recommendation: { id, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      });

      // Accept first recommendation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse(rec1),
      } as Response);
      await useInsightsStore.getState().acceptRecommendation(rec1);

      // Accept second recommendation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse(rec2),
      } as Response);
      await useInsightsStore.getState().acceptRecommendation(rec2);

      // Accept third recommendation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse(rec3),
      } as Response);
      await useInsightsStore.getState().acceptRecommendation(rec3);

      // Verify all recommendations are in dismissedSuggestions
      const state = useInsightsStore.getState();
      expect(state.dismissedSuggestions.size).toBe(3);
      expect(state.dismissedSuggestions.has(rec1)).toBe(true);
      expect(state.dismissedSuggestions.has(rec2)).toBe(true);
      expect(state.dismissedSuggestions.has(rec3)).toBe(true);
    });

    test("should return complete response data", async () => {
      const recommendationId = "rec-456";
      const mockResponse = {
        success: true,
        task: {
          id: "task-789",
          title: "Implement feature X",
          status: "IN_PROGRESS",
          description: "Add new feature",
          priority: "HIGH",
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-15T10:30:00.000Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(result).toEqual(mockResponse);
      expect(result.task.id).toBe("task-789");
      expect(result.recommendation.status).toBe("ACCEPTED");
    });
  });

  describe("Error Handling - HTTP Error Responses", () => {
    test("should throw error on 401 Unauthorized", async () => {
      const recommendationId = "rec-401";
      const errorResponse = { error: "Unauthorized" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Unauthorized");

      // Verify state was not updated
      expect(useInsightsStore.getState().dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should throw error on 403 Insufficient Permissions", async () => {
      const recommendationId = "rec-403";
      const errorResponse = { error: "Insufficient permissions to accept recommendations" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Insufficient permissions to accept recommendations");
    });

    test("should throw error on 404 Recommendation Not Found", async () => {
      const recommendationId = "rec-404";
      const errorResponse = { error: "Recommendation not found" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Recommendation not found");

      // Verify state was not updated
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(0);
    });

    test("should throw error on 400 Recommendation Already Processed", async () => {
      const recommendationId = "rec-400";
      const errorResponse = { error: "Recommendation has already been processed" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Recommendation has already been processed");
    });

    test("should throw error on 400 Assignee Not Member", async () => {
      const recommendationId = "rec-400-assignee";
      const errorResponse = { error: "Assignee is not a member of this workspace" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Assignee is not a member of this workspace");
    });

    test("should throw error on 400 Repository Not Found", async () => {
      const recommendationId = "rec-400-repo";
      const errorResponse = { error: "Repository not found in this workspace" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Repository not found in this workspace");
    });

    test("should throw error on 500 Internal Server Error", async () => {
      const recommendationId = "rec-500";
      const errorResponse = { error: "Internal server error" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Internal server error");
    });

    test("should throw generic error when error field is missing", async () => {
      const recommendationId = "rec-no-error-field";
      const errorResponse = { message: "Something went wrong" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Unknown error");
    });
  });

  describe("Error Handling - Network and Parse Errors", () => {
    test("should throw error on network failure", async () => {
      const recommendationId = "rec-network-fail";

      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Network request failed");

      // Verify state was not updated
      expect(useInsightsStore.getState().dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should throw error on JSON parse failure", async () => {
      const recommendationId = "rec-parse-fail";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Invalid JSON");
    });

    test("should rethrow caught errors", async () => {
      const recommendationId = "rec-rethrow";
      const customError = new Error("Custom error from API");

      mockFetch.mockRejectedValueOnce(customError);

      await expect(
        useInsightsStore.getState().acceptRecommendation(recommendationId)
      ).rejects.toThrow("Custom error from API");
    });
  });

  describe("State Management", () => {
    test("should maintain Set integrity with duplicate IDs", async () => {
      const recommendationId = "rec-duplicate";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      // Accept same recommendation twice
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);
      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      // Set should only contain one instance
      const state = useInsightsStore.getState();
      expect(state.dismissedSuggestions.size).toBe(1);
      expect(state.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should preserve existing dismissedSuggestions when adding new ones", async () => {
      const rec1 = "rec-001";
      const rec2 = "rec-002";

      const mockResponse = (id: string) => ({
        success: true,
        task: { id: `task-${id}`, title: `Task ${id}` },
        recommendation: { id, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      });

      // Accept first recommendation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse(rec1),
      } as Response);
      await useInsightsStore.getState().acceptRecommendation(rec1);

      expect(useInsightsStore.getState().dismissedSuggestions.has(rec1)).toBe(true);

      // Accept second recommendation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse(rec2),
      } as Response);
      await useInsightsStore.getState().acceptRecommendation(rec2);

      // Both should exist
      const state = useInsightsStore.getState();
      expect(state.dismissedSuggestions.has(rec1)).toBe(true);
      expect(state.dismissedSuggestions.has(rec2)).toBe(true);
      expect(state.dismissedSuggestions.size).toBe(2);
    });

    test("should not update dismissedSuggestions on error", async () => {
      const recommendationId = "rec-error-no-update";
      const errorResponse = { error: "Something went wrong" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      } as Response);

      // Initial state should be empty
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(0);

      try {
        await useInsightsStore.getState().acceptRecommendation(recommendationId);
      } catch (error) {
        // Expected to throw
      }

      // State should still be empty
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(0);
      expect(useInsightsStore.getState().dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should reset state correctly", async () => {
      const recommendationId = "rec-reset";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(1);

      // Reset store
      useInsightsStore.getState().reset();

      // State should be reset to initial
      expect(useInsightsStore.getState().dismissedSuggestions.size).toBe(0);
      expect(useInsightsStore.getState().recommendations).toEqual([]);
      expect(useInsightsStore.getState().loading).toBe(false);
    });
  });

  describe("API Request Structure", () => {
    test("should send correct request headers", async () => {
      const recommendationId = "rec-headers";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    test("should send empty JSON body", async () => {
      const recommendationId = "rec-body";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );
    });

    test("should use correct endpoint URL", async () => {
      const recommendationId = "rec-url-123";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.any(Object)
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty recommendation ID", async () => {
      const recommendationId = "";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//accept",
        expect.any(Object)
      );
    });

    test("should handle special characters in recommendation ID", async () => {
      const recommendationId = "rec-123-abc-!@#";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(useInsightsStore.getState().dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle UUID recommendation IDs", async () => {
      const recommendationId = "550e8400-e29b-41d4-a716-446655440000";
      const mockResponse = {
        success: true,
        task: { id: "task-123", title: "Test" },
        recommendation: { id: recommendationId, status: "ACCEPTED", acceptedAt: "2024-01-01T00:00:00.000Z" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await useInsightsStore.getState().acceptRecommendation(recommendationId);

      expect(useInsightsStore.getState().dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });
});