import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";
import { archiveTaskAndRedirect } from "@/app/w/[slug]/task/[...taskParams]/lib/archive-task";

// Mock sonner toast library
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("archiveTaskAndRedirect", () => {
  let originalFetch: typeof global.fetch;
  let originalLocation: Location;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Store original implementations
    originalFetch = global.fetch;
    originalLocation = window.location;

    // Mock fetch API
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock window.location.href
    delete (window as any).location;
    window.location = { href: "" } as Location;

    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original implementations
    global.fetch = originalFetch;
    window.location = originalLocation;
    vi.clearAllMocks();
  });

  describe("SUCCESS: Task archival succeeds", () => {
    test("should archive task and redirect to task list when PATCH returns ok response", async () => {
      // Arrange
      const taskId = "task-123";
      const slug = "test-workspace";
      const errorTitle = "Test Error Title";
      const errorDescription = "Test error description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify PATCH request was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          archived: true,
        }),
      });

      // Assert - Verify toast notification was shown
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });

      // Assert - Verify redirect occurred
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should handle special characters in slug correctly", async () => {
      // Arrange
      const taskId = "task-456";
      const slug = "workspace-with-dash";
      const errorTitle = "No pods available";
      const errorDescription = "Task archived. Please try again later when capacity is available.";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify redirect URL construction
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should preserve taskId format in API request", async () => {
      // Arrange
      const taskId = "abc-def-123-456";
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify correct taskId in URL
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tasks/${taskId}`,
        expect.any(Object)
      );
    });
  });

  describe("API_ERROR: PATCH request fails with non-ok status", () => {
    test("should show error toast and redirect even when PATCH returns 400", async () => {
      // Arrange
      const taskId = "task-789";
      const slug = "workspace";
      const errorTitle = "Bad Request";
      const errorDescription = "Invalid task data";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid task ID" }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify toast.error was called with correct parameters
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });

      // Assert - Function does not check response.ok, so redirect still occurs
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should show error toast and redirect even when PATCH returns 500", async () => {
      // Arrange
      const taskId = "task-999";
      const slug = "workspace";
      const errorTitle = "Server Error";
      const errorDescription = "Internal server error occurred";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify error notification
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });

      // Assert - Function does not check response.ok, so redirect still occurs
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should show error toast and redirect even when PATCH returns 404", async () => {
      // Arrange
      const taskId = "non-existent-task";
      const slug = "workspace";
      const errorTitle = "Task Not Found";
      const errorDescription = "The requested task does not exist";

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Task not found" }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify error notification with original parameters
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });

      // Assert - Function does not check response.ok, so redirect still occurs
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });
  });

  describe("NETWORK_ERROR: fetch throws exception", () => {
    test("should catch network error and show error toast with original parameters", async () => {
      // Arrange
      const taskId = "task-error";
      const slug = "workspace";
      const errorTitle = "Pod claim error";
      const errorDescription = "Task archived. Please try again later.";
      const networkError = new Error("Network request failed");

      mockFetch.mockRejectedValueOnce(networkError);

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify toast.error was called in catch block
      expect(toast.error).toHaveBeenCalledWith("Error", {
        description: "Failed to claim pod and couldn't archive task. Please contact support.",
      });

      // Assert - Verify no redirect occurred
      expect(window.location.href).toBe("");
    });

    test("should handle fetch timeout exception", async () => {
      // Arrange
      const taskId = "task-timeout";
      const slug = "workspace";
      const errorTitle = "Request Timeout";
      const errorDescription = "The request took too long";
      const timeoutError = new Error("Request timeout");

      mockFetch.mockRejectedValueOnce(timeoutError);

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify error handling in catch block
      expect(toast.error).toHaveBeenCalledWith("Error", {
        description: "Failed to claim pod and couldn't archive task. Please contact support.",
      });

      // Assert - Verify no redirect
      expect(window.location.href).toBe("");
    });

    test("should handle abort error exception", async () => {
      // Arrange
      const taskId = "task-aborted";
      const slug = "workspace";
      const errorTitle = "Request Aborted";
      const errorDescription = "Request was cancelled";
      const abortError = new DOMException("The operation was aborted", "AbortError");

      mockFetch.mockRejectedValueOnce(abortError);

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify catch block error handling
      expect(toast.error).toHaveBeenCalledWith("Error", {
        description: "Failed to claim pod and couldn't archive task. Please contact support.",
      });

      // Assert - Verify no redirect
      expect(window.location.href).toBe("");
    });
  });

  describe("PARAMETER_VALIDATION: Edge cases and special values", () => {
    test("should handle empty errorTitle parameter", async () => {
      // Arrange
      const taskId = "task-empty-title";
      const slug = "workspace";
      const errorTitle = "";
      const errorDescription = "Some description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify toast still called with empty title
      expect(toast.error).toHaveBeenCalledWith("", {
        description: errorDescription,
      });
    });

    test("should handle empty errorDescription parameter", async () => {
      // Arrange
      const taskId = "task-empty-desc";
      const slug = "workspace";
      const errorTitle = "Error Title";
      const errorDescription = "";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify toast called with empty description
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: "",
      });
    });

    test("should handle slug with special characters needing URL encoding", async () => {
      // Arrange
      const taskId = "task-special";
      const slug = "workspace with spaces";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify redirect URL (JavaScript doesn't auto-encode, so spaces remain)
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should handle very long taskId", async () => {
      // Arrange
      const taskId = "a".repeat(100); // Very long task ID
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify API call with long taskId
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tasks/${taskId}`,
        expect.any(Object)
      );
    });

    test("should handle taskId with UUID format", async () => {
      // Arrange
      const taskId = "123e4567-e89b-12d3-a456-426614174000";
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify UUID is preserved in API call
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tasks/${taskId}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        })
      );
    });
  });

  describe("PAYLOAD_VERIFICATION: Request structure validation", () => {
    test("should send correct Content-Type header", async () => {
      // Arrange
      const taskId = "task-header";
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify Content-Type header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should send archived: true in request body", async () => {
      // Arrange
      const taskId = "task-payload";
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify request body structure
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ archived: true }),
        })
      );
    });

    test("should use PATCH method for request", async () => {
      // Arrange
      const taskId = "task-method";
      const slug = "workspace";
      const errorTitle = "Error";
      const errorDescription = "Description";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify HTTP method
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });
  });

  describe("INTEGRATION_CONTEXT: Real-world usage scenarios", () => {
    test("should handle 'No pods available' scenario", async () => {
      // Arrange - Simulate pod claim failure scenario
      const taskId = "newly-created-task";
      const slug = "production-workspace";
      const errorTitle = "No pods available";
      const errorDescription = "Task archived. Please try again later when capacity is available.";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify complete flow for this scenario
      expect(mockFetch).toHaveBeenCalledWith(`/api/tasks/${taskId}`, expect.any(Object));
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });

    test("should handle 'Pod claim error' scenario", async () => {
      // Arrange - Simulate network error during pod claim
      const taskId = "task-with-network-issue";
      const slug = "staging-workspace";
      const errorTitle = "Pod claim error";
      const errorDescription = "Task archived. Please try again later.";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      // Act
      await archiveTaskAndRedirect(taskId, slug, errorTitle, errorDescription);

      // Assert - Verify archival and notification flow
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(errorTitle, {
        description: errorDescription,
      });
      expect(window.location.href).toBe(`/w/${slug}/tasks`);
    });
  });
});
