import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

describe("useInsightsStore - acceptRecommendation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Reset store state before each test
    // First reset to get fresh state, then clear the Set to ensure complete isolation
    useInsightsStore.getState().reset();
    useInsightsStore.setState({ dismissedSuggestions: new Set<string>() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success Cases", () => {
    test("should accept recommendation and update state correctly", async () => {
      // Arrange
      const recommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: {
          id: "task-456",
          title: "Implement recommendation",
          status: "TODO",
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-15T10:00:00.000Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      let returnedResult;
      await act(async () => {
        returnedResult = await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Verify API call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      // Assert - Verify state update
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(1);

      // Assert - Verify return value
      expect(returnedResult).toEqual(mockResponse);
      expect(returnedResult.success).toBe(true);
      expect(returnedResult.task).toBeDefined();
      expect(returnedResult.task.id).toBe("task-456");
      expect(returnedResult.recommendation.id).toBe(recommendationId);
      expect(returnedResult.recommendation.status).toBe("ACCEPTED");
    });

    test("should handle multiple recommendation acceptances", async () => {
      // Arrange
      const recommendationIds = ["rec-1", "rec-2", "rec-3"];
      const mockResponses = recommendationIds.map((id) => ({
        success: true,
        task: { id: `task-${id}`, title: `Task for ${id}` },
        recommendation: { id, status: "ACCEPTED" },
      }));

      mockResponses.forEach((response) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => response,
        });
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act - Accept multiple recommendations
      await act(async () => {
        for (const id of recommendationIds) {
          await result.current.acceptRecommendation(id);
        }
      });

      // Assert - All recommendations should be in dismissedSuggestions
      expect(result.current.dismissedSuggestions.size).toBe(3);
      recommendationIds.forEach((id) => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
    });

    test("should preserve existing dismissed suggestions when accepting new recommendation", async () => {
      // Arrange
      const existingId = "rec-existing";
      const newId = "rec-new";

      const { result } = renderHook(() => useInsightsStore());

      // Pre-populate with existing dismissed suggestion
      act(() => {
        result.current.dismissedSuggestions.add(existingId);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task-new" },
          recommendation: { id: newId, status: "ACCEPTED" },
        }),
      });

      // Act
      await act(async () => {
        await result.current.acceptRecommendation(newId);
      });

      // Assert - Both old and new should be present
      expect(result.current.dismissedSuggestions.size).toBe(2);
      expect(result.current.dismissedSuggestions.has(existingId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(newId)).toBe(true);
    });
  });

  describe("Error Handling - API Errors", () => {
    test("should throw error when API returns non-ok response", async () => {
      // Arrange
      const recommendationId = "rec-error";
      const errorMessage = "Recommendation not found";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow(errorMessage);

      // State should not be updated on error
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should throw 'Unknown error' when API returns error without message", async () => {
      // Arrange
      const recommendationId = "rec-no-message";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}), // No error field
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Unknown error");
    });

    test("should handle 401 Unauthorized error", async () => {
      // Arrange
      const recommendationId = "rec-unauthorized";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Unauthorized");
    });

    test("should handle 403 Insufficient permissions error", async () => {
      // Arrange
      const recommendationId = "rec-forbidden";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Insufficient permissions to accept recommendations" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Insufficient permissions to accept recommendations");
    });

    test("should handle 400 Already processed error", async () => {
      // Arrange
      const recommendationId = "rec-already-processed";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Recommendation has already been processed" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Recommendation has already been processed");
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("should propagate network errors when fetch fails", async () => {
      // Arrange
      const recommendationId = "rec-network-error";
      const networkError = new Error("Network request failed");

      mockFetch.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Network request failed");

      // State should not be updated on network error
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should handle fetch rejection without error message", async () => {
      // Arrange
      const recommendationId = "rec-fetch-reject";

      mockFetch.mockRejectedValueOnce("Unknown fetch error");

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toBeTruthy();
    });
  });

  describe("Request Validation", () => {
    test("should make POST request with correct headers and body", async () => {
      // Arrange
      const recommendationId = "rec-validate";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task-1" },
          recommendation: { id: recommendationId },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Verify request structure
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({}),
        })
      );
    });

    test("should construct correct API endpoint for different recommendation IDs", async () => {
      // Arrange
      const testIds = ["rec-123", "recommendation-abc-xyz", "rec_with_underscore"];

      for (const id of testIds) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            task: { id: "task" },
            recommendation: { id },
          }),
        });
      }

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      for (const id of testIds) {
        await act(async () => {
          await result.current.acceptRecommendation(id);
        });

        expect(mockFetch).toHaveBeenCalledWith(
          `/api/janitors/recommendations/${id}/accept`,
          expect.any(Object)
        );
      }
    });
  });

  describe("State Management", () => {
    test("should reset dismissedSuggestions when reset is called", async () => {
      // Arrange
      const recommendationId = "rec-reset-test";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task" },
          recommendation: { id: recommendationId },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept recommendation to populate state
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.size).toBe(1);

      // Act - Reset store
      act(() => {
        result.current.reset();
      });

      // Assert - State should be cleared
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should maintain dismissedSuggestions as a Set data structure", async () => {
      // Arrange
      const recommendationId = "rec-set-test";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task" },
          recommendation: { id: recommendationId },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Should be a Set with Set methods
      expect(result.current.dismissedSuggestions).toBeInstanceOf(Set);
      expect(typeof result.current.dismissedSuggestions.has).toBe("function");
      expect(typeof result.current.dismissedSuggestions.add).toBe("function");
    });

    test("should not add duplicate IDs to dismissedSuggestions (Set behavior)", async () => {
      // Arrange
      const recommendationId = "rec-duplicate";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task" },
          recommendation: { id: recommendationId },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act - Accept same recommendation twice
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Should only have one entry (Set prevents duplicates)
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });

  describe("Return Value Validation", () => {
    test("should return complete response object with all expected fields", async () => {
      // Arrange
      const recommendationId = "rec-complete";
      const mockResponse = {
        success: true,
        task: {
          id: "task-789",
          title: "Complete implementation",
          description: "Task description",
          status: "TODO",
          createdAt: "2024-01-15T10:00:00.000Z",
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-15T10:00:00.000Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      let returnedValue;
      await act(async () => {
        returnedValue = await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Full response structure
      expect(returnedValue).toEqual(mockResponse);
      expect(returnedValue.success).toBe(true);
      expect(returnedValue.task).toBeDefined();
      expect(returnedValue.task.id).toBe("task-789");
      expect(returnedValue.task.title).toBe("Complete implementation");
      expect(returnedValue.recommendation).toBeDefined();
      expect(returnedValue.recommendation.id).toBe(recommendationId);
      expect(returnedValue.recommendation.status).toBe("ACCEPTED");
      expect(returnedValue.recommendation.acceptedAt).toBeDefined();
    });

    test("should return response even with minimal task data", async () => {
      // Arrange
      const recommendationId = "rec-minimal";
      const mockResponse = {
        success: true,
        task: {
          id: "task-minimal",
        },
        recommendation: {
          id: recommendationId,
          status: "ACCEPTED",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      let returnedValue;
      await act(async () => {
        returnedValue = await result.current.acceptRecommendation(recommendationId);
      });

      // Assert
      expect(returnedValue).toEqual(mockResponse);
      expect(returnedValue.task.id).toBe("task-minimal");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty recommendation ID", async () => {
      // Arrange
      const emptyId = "";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid recommendation ID" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act & Assert
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(emptyId);
        });
      }).rejects.toThrow("Invalid recommendation ID");
    });

    test("should handle very long recommendation IDs", async () => {
      // Arrange
      const longId = "rec-" + "x".repeat(500);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task" },
          recommendation: { id: longId },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act
      await act(async () => {
        await result.current.acceptRecommendation(longId);
      });

      // Assert
      expect(result.current.dismissedSuggestions.has(longId)).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${longId}/accept`,
        expect.any(Object)
      );
    });

    test("should handle concurrent acceptance calls", async () => {
      // Arrange
      const ids = ["rec-concurrent-1", "rec-concurrent-2", "rec-concurrent-3"];

      ids.forEach((id) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            task: { id: `task-${id}` },
            recommendation: { id },
          }),
        });
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act - Fire all requests concurrently
      await act(async () => {
        await Promise.all(
          ids.map((id) => result.current.acceptRecommendation(id))
        );
      });

      // Assert - All should be in state
      expect(result.current.dismissedSuggestions.size).toBe(3);
      ids.forEach((id) => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
    });
  });
});