import { describe, test, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

// Mock global fetch
global.fetch = vi.fn();

describe("useInsightsStore - acceptRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state before each test
    const { result } = renderHook(() => useInsightsStore());
    act(() => {
      result.current.reset();
    });
  });

  describe("successful acceptance", () => {
    test("should accept recommendation and update state correctly", async () => {
      const mockRecommendationId = "rec-123";
      const mockResponse = {
        success: true,
        task: {
          id: "task-456",
          title: "Implement recommendation",
        },
        recommendation: {
          id: mockRecommendationId,
          status: "ACCEPTED",
          acceptedAt: "2024-01-01T00:00:00.000Z",
        },
      };

      // Mock successful API response
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Initial state check
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);

      // Accept recommendation
      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(mockRecommendationId);
      });

      // Verify API call
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${mockRecommendationId}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      // Verify state update
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);

      // Verify return value
      expect(acceptResult).toEqual(mockResponse);
    });

    test("should handle recommendation with task creation", async () => {
      const mockRecommendationId = "rec-789";
      const mockResponse = {
        success: true,
        task: {
          id: "task-101",
          title: "Add unit tests",
          description: "Add comprehensive unit tests for feature X",
        },
        recommendation: {
          id: mockRecommendationId,
          status: "ACCEPTED",
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(mockRecommendationId);
      });

      expect(acceptResult.task).toMatchObject({
        id: "task-101",
        title: "Add unit tests",
        description: "Add comprehensive unit tests for feature X",
      });
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);
    });

    test("should add recommendation to dismissedSuggestions Set", async () => {
      const mockIds = ["rec-1", "rec-2", "rec-3"];
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept multiple recommendations
      for (const id of mockIds) {
        await act(async () => {
          await result.current.acceptRecommendation(id);
        });
      }

      // Verify all IDs are in the Set
      mockIds.forEach(id => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
      expect(result.current.dismissedSuggestions.size).toBe(3);
    });

    test("should maintain existing dismissedSuggestions when accepting new recommendation", async () => {
      const existingId = "rec-existing";
      const newId = "rec-new";
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept first recommendation
      await act(async () => {
        await result.current.acceptRecommendation(existingId);
      });

      // Accept second recommendation
      await act(async () => {
        await result.current.acceptRecommendation(newId);
      });

      // Verify both are in the Set
      expect(result.current.dismissedSuggestions.has(existingId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(newId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(2);
    });
  });

  describe("error handling - API error responses", () => {
    test("should throw error for 404 Not Found", async () => {
      const mockRecommendationId = "rec-nonexistent";
      const mockError = { error: "Recommendation not found" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Recommendation not found");

      // Verify state was not updated
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should throw error for 403 Forbidden", async () => {
      const mockRecommendationId = "rec-forbidden";
      const mockError = { error: "Insufficient permissions to accept recommendations" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Insufficient permissions to accept recommendations");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should throw error for 400 Bad Request", async () => {
      const mockRecommendationId = "rec-invalid";
      const mockError = { error: "Recommendation has already been processed" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Recommendation has already been processed");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should throw error for 500 Internal Server Error", async () => {
      const mockRecommendationId = "rec-server-error";
      const mockError = { error: "Internal server error" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Internal server error");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should throw 'Unknown error' when error message is missing", async () => {
      const mockRecommendationId = "rec-no-message";
      const mockError = {}; // No error message

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Unknown error");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should log error to console when API call fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockRecommendationId = "rec-log-test";
      const mockError = { error: "Test error" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow();

      // Verify console.error was called
      expect(consoleErrorSpy).toHaveBeenCalledWith("Accept failed:", mockError);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error accepting recommendation:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("error handling - network failures", () => {
    test("should handle network request failure", async () => {
      const mockRecommendationId = "rec-network-fail";
      const networkError = new Error("Network request failed");

      (global.fetch as Mock).mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Network request failed");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should handle fetch timeout", async () => {
      const mockRecommendationId = "rec-timeout";
      const timeoutError = new Error("Request timeout");

      (global.fetch as Mock).mockRejectedValueOnce(timeoutError);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Request timeout");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should handle JSON parsing errors", async () => {
      const mockRecommendationId = "rec-json-error";

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      });

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow("Invalid JSON");

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should log network errors to console", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mockRecommendationId = "rec-console-test";
      const networkError = new Error("Connection refused");

      (global.fetch as Mock).mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useInsightsStore());

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error accepting recommendation:",
        networkError
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("state management", () => {
    test("should not update state if API call fails", async () => {
      const mockRecommendationId = "rec-fail";
      const mockError = { error: "API error" };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue(mockError),
      });

      const { result } = renderHook(() => useInsightsStore());

      const initialSize = result.current.dismissedSuggestions.size;

      await expect(async () => {
        await act(async () => {
          await result.current.acceptRecommendation(mockRecommendationId);
        });
      }).rejects.toThrow();

      // Verify state remained unchanged
      expect(result.current.dismissedSuggestions.size).toBe(initialSize);
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });

    test("should preserve dismissedSuggestions Set immutability", async () => {
      const mockRecommendationId = "rec-immutable";
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      const originalSet = result.current.dismissedSuggestions;

      await act(async () => {
        await result.current.acceptRecommendation(mockRecommendationId);
      });

      // Verify a new Set instance was created
      expect(result.current.dismissedSuggestions).not.toBe(originalSet);
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);
    });

    test("should handle accepting the same recommendation twice", async () => {
      const mockRecommendationId = "rec-duplicate";
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept the same recommendation twice
      await act(async () => {
        await result.current.acceptRecommendation(mockRecommendationId);
      });

      await act(async () => {
        await result.current.acceptRecommendation(mockRecommendationId);
      });

      // Verify it's still only in the Set once
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);
      expect(result.current.dismissedSuggestions.size).toBe(1);
    });

    test("should reset dismissedSuggestions when store is reset", async () => {
      const mockRecommendationId = "rec-reset";
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(mockRecommendationId);
      });

      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);

      // Reset the store
      act(() => {
        result.current.reset();
      });

      expect(result.current.dismissedSuggestions.size).toBe(0);
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("should handle empty recommendation ID", async () => {
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation("");
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/janitors/recommendations//accept",
        expect.any(Object)
      );
    });

    test("should handle recommendation ID with special characters", async () => {
      const specialId = "rec-123-special!@#$%";
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(specialId);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/janitors/recommendations/${specialId}/accept`,
        expect.any(Object)
      );
      expect(result.current.dismissedSuggestions.has(specialId)).toBe(true);
    });

    test("should handle response with missing task field", async () => {
      const mockRecommendationId = "rec-no-task";
      const mockResponse = {
        success: true,
        recommendation: {
          id: mockRecommendationId,
          status: "ACCEPTED",
        },
        // No task field
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(mockRecommendationId);
      });

      expect(acceptResult).toEqual(mockResponse);
      expect(acceptResult.task).toBeUndefined();
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);
    });

    test("should handle response with additional fields", async () => {
      const mockRecommendationId = "rec-extra-fields";
      const mockResponse = {
        success: true,
        task: { id: "task-1", title: "Test Task" },
        recommendation: { id: mockRecommendationId },
        metadata: { version: "1.0", timestamp: "2024-01-01T00:00:00.000Z" },
        extraField: "extra value",
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(mockRecommendationId);
      });

      expect(acceptResult).toEqual(mockResponse);
      expect(acceptResult.metadata).toBeDefined();
      expect(acceptResult.extraField).toBe("extra value");
    });

    test("should handle response with null values", async () => {
      const mockRecommendationId = "rec-null-values";
      const mockResponse = {
        success: true,
        task: null,
        recommendation: {
          id: mockRecommendationId,
          status: "ACCEPTED",
          assignee: null,
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      let acceptResult;
      await act(async () => {
        acceptResult = await result.current.acceptRecommendation(mockRecommendationId);
      });

      expect(acceptResult.task).toBeNull();
      expect(result.current.dismissedSuggestions.has(mockRecommendationId)).toBe(true);
    });

    test("should handle very long recommendation IDs", async () => {
      const longId = "rec-" + "a".repeat(500);
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        await result.current.acceptRecommendation(longId);
      });

      expect(result.current.dismissedSuggestions.has(longId)).toBe(true);
    });
  });

  describe("concurrent requests", () => {
    test("should handle multiple concurrent acceptRecommendation calls", async () => {
      const mockIds = ["rec-1", "rec-2", "rec-3"];
      const mockResponse = { success: true, task: { id: "task-1" } };

      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const { result } = renderHook(() => useInsightsStore());

      // Accept recommendations concurrently
      await act(async () => {
        await Promise.all(
          mockIds.map(id => result.current.acceptRecommendation(id))
        );
      });

      // Verify all IDs are in the Set
      mockIds.forEach(id => {
        expect(result.current.dismissedSuggestions.has(id)).toBe(true);
      });
      expect(result.current.dismissedSuggestions.size).toBe(3);
    });

    test("should handle mix of successful and failed concurrent requests", async () => {
      const successId = "rec-success";
      const failId = "rec-fail";

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true, task: { id: "task-1" } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: vi.fn().mockResolvedValue({ error: "Not found" }),
        });

      const { result } = renderHook(() => useInsightsStore());

      await act(async () => {
        const promises = [
          result.current.acceptRecommendation(successId),
          result.current.acceptRecommendation(failId).catch(e => e),
        ];
        await Promise.all(promises);
      });

      expect(result.current.dismissedSuggestions.has(successId)).toBe(true);
      expect(result.current.dismissedSuggestions.has(failId)).toBe(false);
    });
  });
});