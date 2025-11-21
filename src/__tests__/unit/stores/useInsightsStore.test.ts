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
    useInsightsStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success Cases", () => {
    test("should accept recommendation and re-fetch recommendations", async () => {
      // Arrange
      const recommendationId = "rec-123";
      const workspaceSlug = "test-workspace";
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

      // Mock accept API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      // Mock fetchRecommendations API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ recommendations: [] }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Set workspace slug
      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      // Act
      let returnedResult;
      await act(async () => {
        returnedResult = await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Verify API calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, `/api/janitors/recommendations/${recommendationId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `/api/workspaces/${workspaceSlug}/janitors/recommendations?limit=10`,
      );

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
      const workspaceSlug = "test-workspace";
      const recommendationIds = ["rec-1", "rec-2", "rec-3"];
      const mockResponses = recommendationIds.map((id) => ({
        success: true,
        task: { id: `task-${id}`, title: `Task for ${id}` },
        recommendation: { id, status: "ACCEPTED" },
      }));

      // Mock accept calls and fetchRecommendations calls
      mockResponses.forEach((response) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => response,
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recommendations: [] }),
        });
      });

      const { result } = renderHook(() => useInsightsStore());

      // Set workspace slug
      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      // Act - Accept multiple recommendations
      await act(async () => {
        for (const id of recommendationIds) {
          await result.current.acceptRecommendation(id);
        }
      });

      // Assert - Verify all API calls were made (accept + fetch for each)
      expect(mockFetch).toHaveBeenCalledTimes(6); // 3 accepts + 3 fetches
    });

    test("should not re-fetch when workspaceSlug is not set", async () => {
      // Arrange
      const recommendationId = "rec-new";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          task: { id: "task-new" },
          recommendation: { id: recommendationId, status: "ACCEPTED" },
        }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Act - Don't set workspaceSlug
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Only accept API call, no fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.any(Object),
      );
    });

    test("should handle refetch failure gracefully after successful acceptance", async () => {
      // Arrange
      const recommendationId = "rec-refetch-fail";
      const workspaceSlug = "test-workspace";
      const mockSuccessResponse = {
        success: true,
        task: { id: "task-123", title: "Test task" },
        recommendation: { id: recommendationId, status: "ACCEPTED" },
      };

      // Mock successful accept API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      // Mock failed refetch call - this should be caught and logged, not thrown
      mockFetch.mockRejectedValueOnce(new Error("Refetch network failure"));

      const { result } = renderHook(() => useInsightsStore());

      // Set workspace slug to trigger refetch
      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      // Act - Should not throw despite refetch failure
      let returnedResult;
      await act(async () => {
        returnedResult = await result.current.acceptRecommendation(recommendationId);
      });

      // Assert - Accept call should succeed and return result
      expect(returnedResult).toEqual(mockSuccessResponse);

      // Assert - Both API calls should have been attempted
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `/api/workspaces/${workspaceSlug}/janitors/recommendations?limit=10`,
      );
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

      // No re-fetch should happen on error
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
        }),
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

        expect(mockFetch).toHaveBeenCalledWith(`/api/janitors/recommendations/${id}/accept`, expect.any(Object));
      }
    });
  });

  describe("State Management", () => {
    test("should store workspaceSlug for re-fetching", async () => {
      // Arrange
      const workspaceSlug = "test-workspace";
      const { result } = renderHook(() => useInsightsStore());

      // Act
      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      // Assert
      expect(result.current.workspaceSlug).toBe(workspaceSlug);
    });

    test("should clear workspaceSlug on reset", async () => {
      // Arrange
      const workspaceSlug = "test-workspace";
      const { result } = renderHook(() => useInsightsStore());

      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      expect(result.current.workspaceSlug).toBe(workspaceSlug);

      // Act - Reset store
      act(() => {
        result.current.reset();
      });

      // Assert - State should be cleared
      expect(result.current.workspaceSlug).toBeNull();
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
      expect(mockFetch).toHaveBeenCalledWith(`/api/janitors/recommendations/${longId}/accept`, expect.any(Object));
    });

    test("should handle concurrent acceptance calls", async () => {
      // Arrange
      const workspaceSlug = "test-workspace";
      const ids = ["rec-concurrent-1", "rec-concurrent-2", "rec-concurrent-3"];

      // Mock each accept and fetch pair
      ids.forEach((id) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            task: { id: `task-${id}` },
            recommendation: { id },
          }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ recommendations: [] }),
        });
      });

      const { result } = renderHook(() => useInsightsStore());

      // Set workspace slug
      act(() => {
        result.current.setWorkspaceSlug(workspaceSlug);
      });

      // Act - Fire all requests concurrently
      await act(async () => {
        await Promise.all(ids.map((id) => result.current.acceptRecommendation(id)));
      });

      // Assert - All API calls should have been made
      expect(mockFetch).toHaveBeenCalledTimes(6); // 3 accepts + 3 fetches
    });
  });
});
