import { describe, test, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

describe("useInsightsStore - dismissRecommendation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset store to initial state
    useInsightsStore.setState({
      recommendations: [],
      janitorConfig: null,
      loading: false,
      recommendationsLoading: false,
      dismissedSuggestions: new Set<string>(),
      showAll: false,
      runningJanitors: new Set<string>(),
      taskCoordinatorEnabled: false,
    });

    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe("Success Path", () => {
    test("successfully dismisses recommendation and updates state", async () => {
      const recommendationId = "rec-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("adds recommendation id to dismissedSuggestions Set", async () => {
      const recommendationId = "rec-456";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Verify Set is initially empty
      expect(result.current.dismissedSuggestions.size).toBe(0);

      await result.current.dismissRecommendation(recommendationId);

      // Verify Set now contains the id
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("makes POST request to correct endpoint with proper headers", async () => {
      const recommendationId = "rec-789";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("handles multiple dismissals correctly", async () => {
      const firstId = "rec-001";
      const secondId = "rec-002";
      const thirdId = "rec-003";
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(firstId);
      await result.current.dismissRecommendation(secondId);
      await result.current.dismissRecommendation(thirdId);

      expect(result.current.dismissedSuggestions.size).toBe(3);
      expect(result.current.dismissedSuggestions.has(firstId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(secondId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(thirdId)).toBe(true);
    });

    test("maintains immutable Set update pattern", async () => {
      const firstId = "rec-alpha";
      const secondId = "rec-beta";
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(firstId);
      const firstSet = result.current.dismissedSuggestions;

      await result.current.dismissRecommendation(secondId);
      const secondSet = result.current.dismissedSuggestions;

      // Verify new Set instance was created (immutability)
      expect(firstSet).not.toBe(secondSet);
      
      // Verify both ids are in the final Set
      expect(secondSet.has(firstId)).toBe(true);
      expect(secondSet.has(secondId)).toBe(true);
    });
  });

  describe("Error Handling - API Errors", () => {
    test("throws error when API returns non-200 status", async () => {
      const recommendationId = "rec-error";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Recommendation not found");
    });

    test("does not update state when API returns error", async () => {
      const recommendationId = "rec-fail";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Verify Set is initially empty
      expect(result.current.dismissedSuggestions.size).toBe(0);

      try {
        await result.current.dismissRecommendation(recommendationId);
      } catch (error) {
        // Expected to throw
      }

      // Verify Set remains empty after error
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("uses error.error message when available", async () => {
      const recommendationId = "rec-custom-error";
      const customErrorMessage = "Custom error message from API";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: customErrorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow(customErrorMessage);
    });

    test("falls back to 'Unknown error' when error.error is undefined", async () => {
      const recommendationId = "rec-unknown-error";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}), // No error field
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Unknown error");
    });

    test("handles 404 Not Found error", async () => {
      const recommendationId = "rec-not-found";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Recommendation not found");
    });

    test("handles 403 Forbidden error", async () => {
      const recommendationId = "rec-forbidden";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Access denied" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Access denied");
    });

    test("handles 500 Internal Server Error", async () => {
      const recommendationId = "rec-server-error";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Internal server error");
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("handles network errors correctly", async () => {
      const recommendationId = "rec-network-error";
      
      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("Network request failed");
    });

    test("does not update state when network error occurs", async () => {
      const recommendationId = "rec-network-fail";
      
      mockFetch.mockRejectedValueOnce(new Error("Connection timeout"));

      const { result } = renderHook(() => useInsightsStore());

      // Verify Set is initially empty
      expect(result.current.dismissedSuggestions.size).toBe(0);

      try {
        await result.current.dismissRecommendation(recommendationId);
      } catch (error) {
        // Expected to throw
      }

      // Verify Set remains empty after network error
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("handles fetch abort error", async () => {
      const recommendationId = "rec-abort";
      
      mockFetch.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(
        result.current.dismissRecommendation(recommendationId)
      ).rejects.toThrow("The operation was aborted");
    });
  });

  describe("State Isolation and Edge Cases", () => {
    test("does not affect other store state properties", async () => {
      const recommendationId = "rec-isolation";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Set some initial state
      result.current.setShowAll(true);
      
      // Wait for the state update to complete
      await waitFor(() => {
        expect(result.current.showAll).toBe(true);
      });
      
      const initialShowAll = result.current.showAll;
      const initialLoading = result.current.loading;
      const initialRecommendations = result.current.recommendations;

      await result.current.dismissRecommendation(recommendationId);

      // Verify other state properties are unchanged
      expect(result.current.showAll).toBe(initialShowAll);
      expect(result.current.loading).toBe(initialLoading);
      expect(result.current.recommendations).toBe(initialRecommendations);
    });

    test("handles empty string id", async () => {
      const recommendationId = "";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      // Empty string should still be added to Set
      expect(result.current.dismissedSuggestions.has("")).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//dismiss",
        expect.any(Object)
      );
    });

    test("handles duplicate dismissal attempts", async () => {
      const recommendationId = "rec-duplicate";
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss same recommendation twice
      await result.current.dismissRecommendation(recommendationId);
      await result.current.dismissRecommendation(recommendationId);

      // Set should still only contain one instance of the id
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
      
      // API should have been called twice
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("maintains state consistency across concurrent dismissals", async () => {
      const ids = ["rec-concurrent-1", "rec-concurrent-2", "rec-concurrent-3"];
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Trigger concurrent dismissals
      await Promise.all(
        ids.map(id => result.current.dismissRecommendation(id))
      );

      // All ids should be in the Set
      expect(result.current.dismissedSuggestions.size).toBe(3);
      ids.forEach(id => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
    });
  });

  describe("API Request Validation", () => {
    test("sends empty JSON body in request", async () => {
      const recommendationId = "rec-body-check";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBe(JSON.stringify({}));
    });

    test("sets correct Content-Type header", async () => {
      const recommendationId = "rec-header-check";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers).toEqual({ "Content-Type": "application/json" });
    });

    test("uses POST method", async () => {
      const recommendationId = "rec-method-check";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe("POST");
    });

    test("constructs correct endpoint URL with recommendation id", async () => {
      const recommendationId = "rec-url-check-123";
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await result.current.dismissRecommendation(recommendationId);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(`/api/janitors/recommendations/${recommendationId}/dismiss`);
    });
  });

  describe("Error Logging", () => {
    test("logs error to console when API returns error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const recommendationId = "rec-log-error";
      const errorMessage = "Test error message";
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await result.current.dismissRecommendation(recommendationId);
      } catch (error) {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Dismiss failed:",
        { error: errorMessage }
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error dismissing recommendation:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("logs error to console when network error occurs", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const recommendationId = "rec-log-network-error";
      const networkError = new Error("Network failure");
      
      mockFetch.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      try {
        await result.current.dismissRecommendation(recommendationId);
      } catch (error) {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error dismissing recommendation:",
        networkError
      );

      consoleErrorSpy.mockRestore();
    });
  });
});