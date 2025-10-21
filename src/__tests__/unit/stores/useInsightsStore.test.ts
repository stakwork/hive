import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

describe("useInsightsStore - acceptRecommendation", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    
    // Reset store to initial state before each test
    const { result } = renderHook(() => useInsightsStore());
    act(() => {
      result.current.reset();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("Successful Acceptance", () => {
    test("should successfully accept recommendation and update state", async () => {
      const mockResult = {
        task: {
          id: "task-123",
          title: "Test Task",
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const { result } = renderHook(() => useInsightsStore());
      const recommendationId = "rec-456";

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(recommendationId);
      });

      // Verify API call was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${recommendationId}/accept`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      // Verify result is returned
      expect(acceptResult).toEqual(mockResult);

      // Verify state was updated - recommendation id added to dismissedSuggestions
      expect(result.current.dismissedSuggestions.has(recommendationId)).toBe(true);
    });

    test("should create new Set instance for dismissedSuggestions (immutability)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());
      
      // Get initial Set reference
      const initialDismissedSuggestions = result.current.dismissedSuggestions;

      await act(async () => {
        await result.current.acceptRecommendation("rec-789");
      });

      // Verify new Set instance was created (not mutated in place)
      expect(result.current.dismissedSuggestions).not.toBe(initialDismissedSuggestions);
      expect(result.current.dismissedSuggestions.has("rec-789")).toBe(true);
    });

    test("should handle multiple recommendations being accepted", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task: { id: "task-1" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task: { id: "task-2" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task: { id: "task-3" } }),
        });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("rec-1");
      });

      await act(async () => {
        await result.current.acceptRecommendation("rec-2");
      });

      await act(async () => {
        await result.current.acceptRecommendation("rec-3");
      });

      // Verify all three recommendations are in dismissedSuggestions
      expect(result.current.dismissedSuggestions.size).toBe(3);
      expect(result.current.dismissedSuggestions.has("rec-1")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-2")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-3")).toBe(true);
    });

    test("should return result object with task property when successful", async () => {
      const mockTask = {
        id: "task-999",
        title: "Implement Feature X",
        status: "TODO",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: mockTask }),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation("rec-999");
      });

      // Verify result contains task property as expected by UI components
      expect(acceptResult).toHaveProperty("task");
      expect(acceptResult.task).toEqual(mockTask);
    });
  });

  describe("API Failure Scenarios", () => {
    test("should throw error when API returns non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Recommendation not found" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation("invalid-rec-id");
        });
      }).rejects.toThrow("Recommendation not found");

      // Verify dismissedSuggestions was not updated
      expect(result.current.dismissedSuggestions.has("invalid-rec-id")).toBe(false);
    });

    test("should throw error with correct message on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server error occurred" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      let caughtError;
      try {
        await act(async () => {
          await result.current.acceptRecommendation("rec-error");
        });
      } catch (error) {
        caughtError = error;
      }

      // Verify error message matches the API response error field
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe("Server error occurred");
    });

    test("should propagate error to UI components for handling", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Permission denied" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Simulate UI component error handling pattern (from RecommendationsSection)
      let errorMessage = "";
      try {
        await act(async () => {
          await result.current.acceptRecommendation("rec-permission-error");
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Please try again.";
      }

      expect(errorMessage).toBe("Permission denied");
    });

    test("should not update state when API call fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed to create task" }),
      });

      const { result } = renderHook(() => useInsightsStore());
      const initialSize = result.current.dismissedSuggestions.size;

      try {
        await act(async () => {
          await result.current.acceptRecommendation("rec-fail");
        });
      } catch (error) {
        // Expected to throw
      }

      // Verify dismissedSuggestions size unchanged
      expect(result.current.dismissedSuggestions.size).toBe(initialSize);
      expect(result.current.dismissedSuggestions.has("rec-fail")).toBe(false);
    });
  });

  describe("Network Error Scenarios", () => {
    test("should propagate network errors", async () => {
      const networkError = new Error("Network request failed");
      mockFetch.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation("rec-network-error");
        });
      }).rejects.toThrow("Network request failed");

      // Verify state was not updated on network error
      expect(result.current.dismissedSuggestions.has("rec-network-error")).toBe(false);
    });

    test("should handle fetch rejection with custom error message", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection timeout"));

      const { result } = renderHook(() => useInsightsStore());

      let caughtError;
      try {
        await act(async () => {
          await result.current.acceptRecommendation("rec-timeout");
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe("Connection timeout");
    });

    test("should log error to console before throwing", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Test error" }),
      });

      const { result } = renderHook(() => useInsightsStore());

      try {
        await act(async () => {
          await result.current.acceptRecommendation("rec-console-error");
        });
      } catch (error) {
        // Expected to throw
      }

      // Verify error was logged to console
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error accepting recommendation:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("API Call Validation", () => {
    test("should call correct endpoint with recommendation id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());
      const testId = "rec-endpoint-test";

      await act(async () => {
        await result.current.acceptRecommendation(testId);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${testId}/accept`,
        expect.any(Object)
      );
    });

    test("should use POST method for API call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("rec-post-test");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("should include correct headers in API call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("rec-headers-test");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should send empty JSON body in API request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("rec-body-test");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle empty string recommendation id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//accept",
        expect.any(Object)
      );
      expect(result.current.dismissedSuggestions.has("")).toBe(true);
    });

    test("should handle recommendation id with special characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());
      const specialId = "rec-@#$%^&*()";

      await act(async () => {
        await result.current.acceptRecommendation(specialId);
      });

      expect(result.current.dismissedSuggestions.has(specialId)).toBe(true);
    });

    test("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Unexpected token in JSON");
        },
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation("rec-malformed-json");
        });
      }).rejects.toThrow("Unexpected token in JSON");
    });

    test("should handle API response without task property", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation("rec-no-task");
      });

      // Verify state was still updated even without task property
      expect(result.current.dismissedSuggestions.has("rec-no-task")).toBe(true);
      expect(acceptResult).toEqual({ success: true });
    });

    test("should handle concurrent acceptRecommendation calls", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task: { id: "task-1" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ task: { id: "task-2" } }),
        });

      const { result } = renderHook(() => useInsightsStore());

      // Make two concurrent calls
      await act(async () => {
        await Promise.all([
          result.current.acceptRecommendation("rec-concurrent-1"),
          result.current.acceptRecommendation("rec-concurrent-2"),
        ]);
      });

      // Verify both recommendations were added
      expect(result.current.dismissedSuggestions.size).toBe(2);
      expect(result.current.dismissedSuggestions.has("rec-concurrent-1")).toBe(true);
      expect(result.current.dismissedSuggestions.has("rec-concurrent-2")).toBe(true);
    });
  });

  describe("State Reset", () => {
    test("should clear dismissedSuggestions when reset is called", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: { id: "task-123" } }),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept a recommendation
      await act(async () => {
        await result.current.acceptRecommendation("rec-to-reset");
      });

      expect(result.current.dismissedSuggestions.has("rec-to-reset")).toBe(true);

      // Reset store
      act(() => {
        result.current.reset();
      });

      // Verify dismissedSuggestions was cleared
      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has("rec-to-reset")).toBe(false);
    });
  });
});