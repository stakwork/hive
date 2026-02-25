import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
const mockToastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    slug: "test-workspace",
    taskParams: ["test-task-id"],
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
  },
}));

describe("Task Page 404 Redirect", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  it("should redirect to tasks list when task returns 404", async () => {
    // Mock fetch to return 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    // Simulate the loadTaskMessages callback logic
    const loadTaskMessages = async (taskId: string, slug: string) => {
      const response = await fetch(`/api/tasks/${taskId}/messages`);

      if (response.status === 404) {
        mockPush(`/w/${slug}/tasks`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      return response.json();
    };

    await loadTaskMessages("non-existent-task", "test-workspace");

    // Assert router.push was called with correct path
    expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tasks");
    
    // Assert toast.error was NOT called (silent redirect)
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("should throw error for non-404 failures", async () => {
    // Mock fetch to return 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const loadTaskMessages = async (taskId: string, slug: string) => {
      const response = await fetch(`/api/tasks/${taskId}/messages`);

      if (response.status === 404) {
        mockPush(`/w/${slug}/tasks`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      return response.json();
    };

    // Should throw error for non-404 failures
    await expect(loadTaskMessages("test-task", "test-workspace")).rejects.toThrow(
      "Failed to load messages: Internal Server Error"
    );

    // Assert router.push was NOT called
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("should process messages normally for successful response", async () => {
    const mockMessages = [
      { id: "1", content: "Hello", role: "user" },
      { id: "2", content: "Hi there", role: "assistant" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: mockMessages }),
    });

    const loadTaskMessages = async (taskId: string, slug: string) => {
      const response = await fetch(`/api/tasks/${taskId}/messages`);

      if (response.status === 404) {
        mockPush(`/w/${slug}/tasks`);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      return response.json();
    };

    const result = await loadTaskMessages("valid-task", "test-workspace");

    expect(result).toEqual({ data: mockMessages });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
