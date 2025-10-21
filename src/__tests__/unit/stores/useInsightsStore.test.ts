import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

// Mock fetch globally for all tests
const mockFetch = vi.fn();

describe("useInsightsStore - acceptRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    
    // Reset store state before each test
    const { result } = renderHook(() => useInsightsStore());
    act(() => {
      result.current.reset();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Successful Recommendation Acceptance", () => {
    test("should accept recommendation and update dismissedSuggestions Set", async () => {
      const recommendationId = "rec-123";
      const mockResponse = {
        result: {
          task: {
            id: "task-123",
            title: "Test Task",
            status: "TODO",
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      // Verify Set is empty initially
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(recommendationId);
      });

      // Verify API was called with correct endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );

      // Verify response is returned
      expect(acceptResult).toEqual(mockResponse);

      // Verify dismissedSuggestions Set is updated
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle multiple recommendation acceptances and accumulate in Set", async () => {
      const rec1 = "rec-1";
      const rec2 = "rec-2";
      const rec3 = "rec-3";

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-1" } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-2" } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-3" } } }),
        });

      const { result } = renderHook(() => useInsightsStore());

      // Accept multiple recommendations
      await act(async () => {
        await result.current.acceptRecommendation(rec1);
        await result.current.acceptRecommendation(rec2);
        await result.current.acceptRecommendation(rec3);
      });

      // Verify all IDs are in the Set
      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec2)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec3)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(3);
    });

    test("should return complete response object from API", async () => {
      const recommendationId = "rec-456";
      const mockResponse = {
        result: {
          task: {
            id: "task-456",
            title: "Complete Task",
            description: "Task description",
            status: "IN_PROGRESS",
            priority: "HIGH",
          },
        },
        metadata: {
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(recommendationId);
      });

      expect(acceptResult).toEqual(mockResponse);
      expect(acceptResult.result.task.id).toBe("task-456");
      expect(acceptResult.result.task.title).toBe("Complete Task");
    });

    test("should not add duplicate IDs to dismissedSuggestions Set", async () => {
      const recommendationId = "rec-duplicate";

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-1" } } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-1" } } }),
        });

      const { result } = renderHook(() => useInsightsStore());

      // Accept same recommendation twice
      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
        await result.current.acceptRecommendation(recommendationId);
      });

      // Set should only contain one entry (Set de-duplicates)
      expect(result.current.dismissedSuggestions.size).toBe(1);
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });

  describe("Error Handling - API Errors", () => {
    test("should throw error when API returns non-ok response with error.error field", async () => {
      const recommendationId = "rec-error";
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

      // Verify dismissedSuggestions Set is NOT updated on error
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should throw 'Unknown error' when API returns non-ok response without error field", async () => {
      const recommendationId = "rec-no-error";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "Something went wrong" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Unknown error");

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should handle 404 Not Found error", async () => {
      const recommendationId = "rec-404";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Recommendation not found");
    });

    test("should handle 403 Forbidden error", async () => {
      const recommendationId = "rec-403";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Access denied" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Access denied");
    });

    test("should handle 500 Internal Server Error", async () => {
      const recommendationId = "rec-500";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Internal server error");
    });

    test("should handle malformed JSON response", async () => {
      const recommendationId = "rec-malformed";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow();
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("should throw error when fetch fails with network error", async () => {
      const recommendationId = "rec-network-error";

      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Network request failed");

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(false);
    });

    test("should handle timeout errors", async () => {
      const recommendationId = "rec-timeout";

      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Request timeout");
    });

    test("should handle connection refused errors", async () => {
      const recommendationId = "rec-connection-refused";

      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(recommendationId);
        });
      }).rejects.toThrow("Connection refused");
    });
  });

  describe("Edge Cases and Input Validation", () => {
    test("should handle empty string ID", async () => {
      const recommendationId = "";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-empty" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations//accept`,
        expect.any(Object)
      );
      expect(result.current.dismissedSuggestions.has("")).toBe(true);
    });

    test("should handle IDs with special characters", async () => {
      const recommendationId = "rec-!@#$%^&*()";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-special" } } }),
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

    test("should handle very long IDs", async () => {
      const recommendationId = "rec-" + "a".repeat(1000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-long" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should handle IDs with URL-unsafe characters", async () => {
      const recommendationId = "rec/with/slashes?and=query&params#hash";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-url-unsafe" } } }),
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

    test("should handle unicode characters in ID", async () => {
      const recommendationId = "rec-测试-🎯-тест";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-unicode" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });
  });

  describe("Request Format Validation", () => {
    test("should send POST request with correct headers", async () => {
      const recommendationId = "rec-headers";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-headers" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should send empty object as request body", async () => {
      const recommendationId = "rec-body";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-body" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(recommendationId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );
    });

    test("should construct correct endpoint URL with recommendation ID", async () => {
      const recommendationId = "rec-endpoint-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-endpoint" } } }),
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
  });

  describe("State Isolation and Reset", () => {
    test("should maintain separate Set instances across store resets", async () => {
      const rec1 = "rec-reset-1";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { task: { id: "task-reset-1" } } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(rec1);
      });

      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(1);

      // Reset store
      act(() => {
        result.current.reset();
      });

      // Verify Set is cleared after reset
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(rec1)).toBe(false);
    });

    test("should handle errors without affecting existing dismissed recommendations", async () => {
      const rec1 = "rec-existing";
      const rec2 = "rec-error";

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { task: { id: "task-1" } } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: "Failed to accept" }),
        });

      const { result } = renderHook(() => useInsightsStore());

      // Accept first recommendation successfully
      await act(async () => {
        await result.current.acceptRecommendation(rec1);
      });

      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);

      // Try to accept second recommendation (should fail)
      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(rec2);
        });
      }).rejects.toThrow("Failed to accept");

      // First recommendation should still be in Set
      expect(result.current.dismissedSuggestions.has(rec1)).toBe(true);
      expect(result.current.dismissedSuggestions.has(rec2)).toBe(false);
      expect(result.current.dismissedSuggestions.size).toBe(1);
    });
  });

  describe("Integration with UI Error Handling", () => {
    test("should throw error that can be caught by UI try-catch blocks", async () => {
      const recommendationId = "rec-ui-error";
      const errorMessage = "UI caught this error";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.acceptRecommendation(recommendationId);
        } catch (error) {
          caughtError = error as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toBe(errorMessage);
    });

    test("should provide error.message property for toast notifications", async () => {
      const recommendationId = "rec-toast-error";
      const errorMessage = "Failed to accept recommendation";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: errorMessage }),
      });

      const { result } = renderHook(() => useInsightsStore());

      let errorForToast: Error | null = null;
      await act(async () => {
        try {
          await result.current.acceptRecommendation(recommendationId);
        } catch (error) {
          errorForToast = error as Error;
        }
      });

      // Verify error has message property for UI toast usage
      expect(errorForToast).toHaveProperty("message");
      expect(errorForToast?.message).toBe(errorMessage);
    });
  });
});