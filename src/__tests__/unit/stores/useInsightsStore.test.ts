import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchSuccessMultiple,
  mockFetchErrorMultiple,
  mockFetchNetworkError,
} from "./helpers/mockFetchHelper";
import {
  testAcceptRecommendation,
  testDismissRecommendation,
  setupFreshStore,
  getStoreInstance,
} from "./helpers/storeTestHelper";
import {
  TEST_RECOMMENDATION_IDS,
  createMockSuccessResponse,
  createMinimalSuccessResponse,
  createCompleteTaskResponse,
  createResponseWithMetadata,
  ERROR_MESSAGES,
} from "./helpers/testData";

describe("useInsightsStore - acceptRecommendation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset store to initial state
    setupFreshStore();
    
    // Clear all mocks
    vi.clearAllMocks();
    
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Clean up fetch mock
    vi.restoreAllMocks();
  });

  describe("Success Scenarios", () => {
    test("should make POST request to correct endpoint with correct headers and body", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: { id: "task-1", title: "Test Task" },
        recommendation: { id: recommendationId, status: "ACCEPTED" }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
    });

    test("should update dismissedSuggestions state on success", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: { id: "task-1" },
        recommendation: { id: recommendationId, status: "ACCEPTED" }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      // Initial state - empty dismissed suggestions
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // After accept - recommendation should be in dismissed suggestions
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should return API response data on success", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: { id: "task-1", title: "Test Task" },
        recommendation: { id: recommendationId, status: "ACCEPTED" }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      let apiResult;
      await act(async () => {
        apiResult = await result.current.acceptRecommendation(recommendationId);
      });

      expect(apiResult).toEqual(mockResponse);
    });

    test("should maintain previous dismissed suggestions when adding new one", async () => {
      const firstId = "rec-1";
      const secondId = "rec-2";
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept first recommendation
      await act(async () => {
        await result.current.acceptRecommendation(firstId);
      });

      expect(result.current.dismissedSuggestions.has(firstId)).toBe(true);

      // Accept second recommendation
      await act(async () => {
        await result.current.acceptRecommendation(secondId);
      });

      // Both should be in dismissed suggestions
      expect(result.current.dismissedSuggestions.has(firstId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(secondId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(2);
    });

    test("should handle accepting multiple recommendations sequentially", async () => {
      const ids = ["rec-1", "rec-2", "rec-3", "rec-4"];
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      for (const id of ids) {
        await act(async () => {
          await result.current.acceptRecommendation(id);
        });
      }

      expect(result.current.dismissedSuggestions.size).toBe(4);
      ids.forEach(id => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
    });
  });

  describe("Error Scenarios", () => {
    test("should throw error when API returns not ok status", async () => {
      const recommendationId = "rec-123";
      const errorMessage = "Recommendation not found";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow(errorMessage);
    });

    test("should throw 'Unknown error' when API returns no error message", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}), // No error message
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Unknown error");
    });

    test("should not update state when API fails", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);

      try {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      } catch {
        // Expected to throw
      }

      // State should not be updated
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should re-throw network errors", async () => {
      const recommendationId = "rec-123";
      const networkError = new Error("Network failure");

      mockFetch.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Network failure");
    });

    test("should handle 401 Unauthorized error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unauthorized" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Unauthorized");
    });

    test("should handle 403 Insufficient permissions error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Insufficient permissions to accept recommendations" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Insufficient permissions to accept recommendations");
    });

    test("should handle 404 Recommendation not found error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Recommendation not found");
    });

    test("should handle 400 Recommendation already processed error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Recommendation has already been processed" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Recommendation has already been processed");
    });

    test("should handle 400 Assignee not member error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Assignee is not a member of this workspace" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Assignee is not a member of this workspace");
    });

    test("should handle 400 Repository not found error", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Repository not found in this workspace" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Repository not found in this workspace");
    });

    test("should not update state when multiple accepts fail", async () => {
      const ids = ["rec-1", "rec-2", "rec-3"];

      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Failed" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      for (const id of ids) {
        try {
          await act(async () => {
            await result.current.acceptRecommendation(id);
          });
        } catch {
          // Expected to throw
        }
      }

      expect(result.current.dismissedSuggestions.size).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty recommendation ID", async () => {
      const recommendationId = "";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.any(Object)
      );
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle very long recommendation ID", async () => {
      const recommendationId = "a".repeat(1000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle special characters in recommendation ID", async () => {
      const recommendationId = "rec-123-abc_def@456";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.any(Object)
      );
    });

    test("should handle UUID format recommendation ID", async () => {
      const recommendationId = "550e8400-e29b-41d4-a716-446655440000";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });

  describe("State Management", () => {
    test("should not affect other store state when accepting recommendation", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      const initialRecommendations = result.current.recommendations;
      const initialJanitorConfig = result.current.janitorConfig;
      const initialLoading = result.current.loading;
      const initialShowAll = result.current.showAll;
      const initialRecommendationsLoading = result.current.recommendationsLoading;
      const initialRunningJanitors = result.current.runningJanitors;
      const initialTaskCoordinatorEnabled = result.current.taskCoordinatorEnabled;

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Other state should remain unchanged
      expect(result.current.recommendations).toBe(initialRecommendations);
      expect(result.current.janitorConfig).toBe(initialJanitorConfig);
      expect(result.current.loading).toBe(initialLoading);
      expect(result.current.showAll).toBe(initialShowAll);
      expect(result.current.recommendationsLoading).toBe(initialRecommendationsLoading);
      expect(result.current.runningJanitors).toBe(initialRunningJanitors);
      expect(result.current.taskCoordinatorEnabled).toBe(initialTaskCoordinatorEnabled);
    });

    test("should handle accepting same recommendation twice", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept first time
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.size).toBe(1);

      // Accept second time (same ID)
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Set should still have only one entry (Sets don't allow duplicates)
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should maintain Set immutability by creating new Set instance", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      const initialSet = result.current.dismissedSuggestions;

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      const updatedSet = result.current.dismissedSuggestions;

      // Should be a new Set instance (immutable update)
      expect(updatedSet).not.toBe(initialSet);
      expect(updatedSet.has(recommendationId)).toBe(true);
    });

    test("should preserve existing dismissed suggestions from other actions", async () => {
      const recommendationId = "rec-accept";
      const dismissedId = "rec-dismissed";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Manually add a dismissed suggestion (simulating dismissRecommendation)
      await act(async () => {
        await result.current.dismissRecommendation(dismissedId);
      });

      expect(result.current.dismissedSuggestions.has(dismissedId)).toBe(true);

      // Now accept a different recommendation
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Both should be in dismissed suggestions
      expect(result.current.dismissedSuggestions.has(dismissedId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(2);
    });

    test("should handle reset after accepting recommendations", async () => {
      const recommendationId = "rec-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept recommendation
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);

      // Reset store
      act(() => {
        result.current.reset();
      });

      // State should be cleared
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });
  });

  describe("Console Logging", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    test("should log error when API returns error", async () => {
      const recommendationId = "rec-123";
      const errorMessage = "Test error";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      } catch {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Accept failed:",
        { error: errorMessage }
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error accepting recommendation:",
        expect.any(Error)
      );
    });

    test("should log error when network failure occurs", async () => {
      const recommendationId = "rec-123";
      const networkError = new Error("Network failure");

      mockFetch.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      } catch {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error accepting recommendation:",
        networkError
      );
    });

    test("should log both error messages on API failure", async () => {
      const recommendationId = "rec-123";
      const errorResponse = { error: "API Error" };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => errorResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      } catch {
        // Expected to throw
      }

      // Should log both the API error response and the caught error
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, "Accept failed:", errorResponse);
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, "Error accepting recommendation:", expect.any(Error));
    });
  });

  describe("API Response Validation", () => {
    test("should handle response with complete task data", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: {
          id: "task-1",
          title: "Implement unit tests",
          description: "Add test coverage",
          status: "TODO",
          priority: "HIGH"
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-01T00:00:00.000Z"
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      let response;
      await act(async () => {
        response = await result.current.acceptRecommendation(recommendationId);
      });

      expect(response).toEqual(mockResponse);
      expect(response?.task).toBeDefined();
      expect(response?.task?.id).toBe("task-1");
    });

    test("should handle minimal success response", async () => {
      const recommendationId = "rec-123";
      const mockResponse = { success: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      let response;
      await act(async () => {
        response = await result.current.acceptRecommendation(recommendationId);
      });

      expect(response).toEqual(mockResponse);
    });

    test("should handle response with additional metadata", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: { id: "task-1" },
        recommendation: { id: recommendationId },
        metadata: {
          processingTime: 150,
          aiModel: "gpt-4",
          confidence: 0.95
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      let response;
      await act(async () => {
        response = await result.current.acceptRecommendation(recommendationId);
      });

      expect(response).toEqual(mockResponse);
      expect(response?.metadata).toBeDefined();
    });
  });
});