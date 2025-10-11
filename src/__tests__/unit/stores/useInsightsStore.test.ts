import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

describe("useInsightsStore - dismissRecommendation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset store state before each test
    useInsightsStore.getState().reset();
    
    // Clear all mocks
    vi.clearAllMocks();
    
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Ensure store is clean after each test
    useInsightsStore.getState().reset();
  });

  describe("Successful Dismissal", () => {
    test("should add recommendation ID to dismissedSuggestions on successful API response", async () => {
      const recommendationId = "rec-123";
      
      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Execute dismissal
      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      // Verify state update
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(1);
    });

    test("should handle multiple dismissals correctly", async () => {
      const rec1 = "rec-123";
      const rec2 = "rec-456";
      const rec3 = "rec-789";
      
      // Mock successful API responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Execute multiple dismissals
      await act(async () => {
        await result.current.dismissRecommendation(rec1);
      });

      await act(async () => {
        await result.current.dismissRecommendation(rec2);
      });

      await act(async () => {
        await result.current.dismissRecommendation(rec3);
      });

      // Verify all IDs are in the set
      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec2)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec3)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(3);
    });

    test("should not add duplicate IDs to dismissedSuggestions", async () => {
      const recommendationId = "rec-123";
      
      // Mock successful API responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss same recommendation twice
      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      // Set should only contain one entry
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });

  describe("API Call Verification", () => {
    test("should call correct API endpoint with POST method", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/dismiss`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
    });

    test("should call API with correct recommendation ID in URL", async () => {
      const recommendationId = "rec-unique-id-456";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/dismiss`,
        expect.any(Object)
      );
    });

    test("should send empty JSON body in request", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBe(JSON.stringify({}));
    });
  });

  describe("API Error Handling", () => {
    test("should throw error when API returns non-200 response", async () => {
      const recommendationId = "rec-123";
      
      // Mock API error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Expect error to be thrown
      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Recommendation not found");
    });

    test("should throw error with API error message", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Insufficient permissions" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Insufficient permissions");
    });

    test("should throw 'Unknown error' when API returns no error message", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Unknown error");
    });

    test("should not update state when API returns error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed to dismiss" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        });
      } catch (error) {
        // Expected to throw
      }

      // State should not be updated
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should handle 401 unauthorized error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Unauthorized");
    });

    test("should handle 403 forbidden error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Forbidden");
    });

    test("should handle 404 not found error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Recommendation not found");
    });

    test("should handle 500 server error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Internal server error");
    });
  });

  describe("Network Error Handling", () => {
    test("should throw error on network failure", async () => {
      const recommendationId = "rec-123";
      
      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Network error");
    });

    test("should throw error on fetch timeout", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Request timeout");
    });

    test("should not update state on network error", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        });
      } catch (error) {
        // Expected to throw
      }

      // State should remain unchanged
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should handle JSON parse error gracefully", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        })
      ).rejects.toThrow("Invalid JSON");
    });
  });

  describe("State Isolation and Cleanup", () => {
    test("should start with empty dismissedSuggestions", () => {
      const { result } = renderHook(() => useInsightsStore());

      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should clear dismissedSuggestions on store reset", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Add recommendation to dismissed
      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.size).toBe(1);

      // Reset store
      act(() => {
        result.current.reset();
      });

      // Should be empty
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should maintain state isolation between tests", async () => {
      const { result } = renderHook(() => useInsightsStore());

      // First test execution - state should be empty
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should not affect other store state on error", async () => {
      const recommendationId = "rec-123";
      
      // Set up initial store state
      const { result } = renderHook(() => useInsightsStore());
      const initialRecommendations = result.current.recommendations;
      const initialLoading = result.current.loading;

      // Mock error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed" }),
      });

      try {
        await act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        });
      } catch (error) {
        // Expected
      }

      // Other state should remain unchanged
      expect(result.current.recommendations).toBe(initialRecommendations);
      expect(result.current.loading).toBe(initialLoading);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string recommendation ID", async () => {
      const recommendationId = "";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      // Should still call API and update state
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//dismiss",
        expect.any(Object)
      );
      
      await act(async () => {
        expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      });
    });

    test("should handle very long recommendation ID", async () => {
      const recommendationId = "a".repeat(1000);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      await act(async () => {
        expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      });
    });

    test("should handle recommendation ID with special characters", async () => {
      const recommendationId = "rec-123-test-!@#$%";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/dismiss`,
        expect.any(Object)
      );
      
      await act(async () => {
        expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      });
    });

    test("should handle rapid sequential dismissals", async () => {
      const ids = ["rec-1", "rec-2", "rec-3", "rec-4", "rec-5"];
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss all rapidly
      await act(async () => {
        await Promise.all(
          ids.map((id) => result.current.dismissRecommendation(id))
        );
      });

      // All should be dismissed
      ids.forEach((id) => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
      expect(result.current.dismissedSuggestions.size).toBe(5);
    });

    test("should handle partial failures in batch dismissals", async () => {
      const rec1 = "rec-success";
      const rec2 = "rec-failure";
      const rec3 = "rec-success-2";

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          return {
            ok: false,
            json: async () => ({ error: "Failed" }),
          };
        }
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      });

      const { result } = renderHook(() => useInsightsStore());

      // Try dismissing all
      await act(async () => {
        await result.current.dismissRecommendation(rec1);
      });

      try {
        await act(async () => {
          await result.current.dismissRecommendation(rec2);
        });
      } catch (error) {
        // Expected
      }

      await act(async () => {
        await result.current.dismissRecommendation(rec3);
      });

      // Only successful dismissals should be in state
      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec2)).toBe(false);
      expect(result.current.dismissedSuggestions.has(rec3)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(2);
    });
  });

  describe("Console Error Logging", () => {
    test("should log to console.error on API failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "API error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        });
      } catch (error) {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Dismiss failed:",
        expect.objectContaining({ error: "API error" })
      );

      consoleErrorSpy.mockRestore();
    });

    test("should log to console.error on network failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const recommendationId = "rec-123";
      
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.dismissRecommendation(recommendationId);
        });
      } catch (error) {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error dismissing recommendation:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});