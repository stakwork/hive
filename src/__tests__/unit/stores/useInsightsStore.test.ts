import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

describe("useInsightsStore - dismissRecommendation", () => {
  // Mock fetch globally
  const mockFetch = vi.fn();

  beforeEach(() => {
    // Reset store state - clear the dismissedSuggestions Set
    useInsightsStore.getState().dismissedSuggestions.clear();
    
    // Clear all mocks
    vi.clearAllMocks();
    
    // Setup fetch mock
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("Successful Dismissal", () => {
    test("should add recommendation to dismissedSuggestions on success", async () => {
      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      // Execute dismissal
      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      // Assert state update
      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(1);
    });

    test("should call correct API endpoint with POST method", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation("rec-456");
      });

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations/rec-456/dismiss",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should maintain multiple dismissed recommendations", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss multiple recommendations
      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      await act(async () => {
        await result.current.dismissRecommendation("rec-456");
      });

      await act(async () => {
        await result.current.dismissRecommendation("rec-789");
      });

      // All should be in the Set
      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-456")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-789")).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(3);
    });

    test("should handle duplicate dismissal with Set deduplication", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss same recommendation twice
      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      // Should still have only one entry (Set deduplication)
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Handling", () => {
    test("should throw error on API failure with error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Recommendation not found" }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("rec-123");
        });
      }).rejects.toThrow("Recommendation not found");

      // State should remain unchanged
      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(0);
    });

    test("should throw 'Unknown error' when API returns no error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("rec-123");
        });
      }).rejects.toThrow("Unknown error");

      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(false);
    });

    test("should throw error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("rec-123");
        });
      }).rejects.toThrow("Network error");

      expect(result.current.dismissedSuggestions.has("rec-123")).toBe(false);
    });

    test("should handle 404 Not Found response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Recommendation not found" }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("non-existent-id");
        });
      }).rejects.toThrow("Recommendation not found");
    });

    test("should handle 403 Forbidden response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Insufficient permissions" }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("rec-123");
        });
      }).rejects.toThrow("Insufficient permissions");
    });

    test("should handle 500 Internal Server Error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.dismissRecommendation("rec-123");
        });
      }).rejects.toThrow("Internal server error");
    });
  });

  describe("State Consistency", () => {
    test("should not update state when API call fails", async () => {
      const { result } = renderHook(() => useInsightsStore());

      // Pre-dismiss another recommendation successfully
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      await act(async () => {
        await result.current.dismissRecommendation("rec-existing");
      });

      const sizeBefore = result.current.dismissedSuggestions.size;

      // Mock failure for next call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Bad request" }),
      } as Response);

      // Try to dismiss with error
      try {
        await act(async () => {
          await result.current.dismissRecommendation("rec-fail");
        });
      } catch (error) {
        // Expected to throw
      }

      // Size should be unchanged
      expect(result.current.dismissedSuggestions.size).toBe(sizeBefore);
      expect(result.current.dismissedSuggestions.has("rec-existing")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-fail")).toBe(false);
    });

    test("should preserve existing dismissed recommendations after error", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      // Dismiss some recommendations successfully
      await act(async () => {
        await result.current.dismissRecommendation("rec-1");
      });

      await act(async () => {
        await result.current.dismissRecommendation("rec-2");
      });

      // Mock error for next call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
      } as Response);

      // Try to dismiss with error
      try {
        await act(async () => {
          await result.current.dismissRecommendation("rec-3");
        });
      } catch (error) {
        // Expected to throw
      }

      // Previous dismissals should still exist
      expect(result.current.dismissedSuggestions.has("rec-1")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-2")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-3")).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(2);
    });

    test("should maintain state isolation between test runs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      // State should be empty at start
      expect(result.current.dismissedSuggestions.size).toBe(0);

      await act(async () => {
        await result.current.dismissRecommendation("rec-test");
      });

      expect(result.current.dismissedSuggestions.size).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty recommendation ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation("");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//dismiss",
        expect.any(Object)
      );
      expect(result.current.dismissedSuggestions.has("")).toBe(true);
    });

    test("should handle recommendation ID with special characters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());
      const specialIds = [
        "rec-123-abc-def",
        "rec_underscore_test",
        "rec.dot.test",
        "rec:colon:test",
      ];

      for (const specialId of specialIds) {
        await act(async () => {
          await result.current.dismissRecommendation(specialId);
        });

        expect(result.current.dismissedSuggestions.has(specialId)).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/janitors/recommendations/${specialId}/dismiss`,
          expect.any(Object)
        );
      }

      expect(result.current.dismissedSuggestions.size).toBe(specialIds.length);
    });

    test("should handle very long recommendation ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());
      const longId = "rec-" + "a".repeat(500);

      await act(async () => {
        await result.current.dismissRecommendation(longId);
      });

      expect(result.current.dismissedSuggestions.has(longId)).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${longId}/dismiss`,
        expect.any(Object)
      );
    });

    test("should handle UUID-format recommendation IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());
      const uuidId = "550e8400-e29b-41d4-a716-446655440000";

      await act(async () => {
        await result.current.dismissRecommendation(uuidId);
      });

      expect(result.current.dismissedSuggestions.has(uuidId)).toBe(true);
    });

    test("should handle rapid sequential dismissals", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());
      const ids = Array.from({ length: 10 }, (_, i) => `rec-${i}`);

      // Dismiss all rapidly
      for (const id of ids) {
        await act(async () => {
          await result.current.dismissRecommendation(id);
        });
      }

      // All should be dismissed
      expect(result.current.dismissedSuggestions.size).toBe(10);
      ids.forEach((id) => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
    });
  });

  describe("API Request Format", () => {
    test("should send correct Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
    });

    test("should send empty JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.body).toBe(JSON.stringify({}));
    });

    test("should use POST method", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.dismissRecommendation("rec-123");
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("POST");
    });
  });
});