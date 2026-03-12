import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: "test-user-id",
        name: "Test User",
        email: "test@example.com",
      },
    },
    status: "authenticated",
  })),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Mock Pusher
vi.mock("pusher-js", () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn().mockReturnValue({
      bind: vi.fn(),
      unbind: vi.fn(),
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

describe("useWorkspaceTasks - URL-based pagination", () => {
  const mockWorkspaceId = "workspace-123";
  const mockWorkspaceSlug = "test-workspace";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockResponse = (tasks: any[], page: number, hasMore: boolean) => ({
    success: true,
    data: tasks,
    pagination: {
      currentPage: page,
      totalPages: hasMore ? page + 1 : page,
      totalTasks: tasks.length * (hasMore ? 2 : 1),
      hasMore,
    },
  });

  const mockTask = (id: string, title: string) => ({
    id,
    title,
    status: "TODO",
    priority: "MEDIUM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  describe("initialPage parameter", () => {
    test("should start at page 1 when initialPage is not provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      renderHook(() =>
        useWorkspaceTasks(mockWorkspaceId, mockWorkspaceSlug, true, 10)
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("page=1"),
          expect.any(Object)
        );
      });
    });

    test("should start at page 1 when initialPage is 1", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          1
        )
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("page=1"),
          expect.any(Object)
        );
      });
    });

    test("should replay pages 1 through N when initialPage > 1", async () => {
      const page1Tasks = [mockTask("1", "Task 1"), mockTask("2", "Task 2")];
      const page2Tasks = [mockTask("3", "Task 3"), mockTask("4", "Task 4")];
      const page3Tasks = [mockTask("5", "Task 5"), mockTask("6", "Task 6")];

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse(page1Tasks, 1, true),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse(page2Tasks, 2, true),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse(page3Tasks, 3, false),
        });
      global.fetch = mockFetch;

      const { result } = renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          3 // initialPage = 3
        )
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      // Verify pages were fetched in order
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("page=1"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("page=2"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("page=3"),
        expect.any(Object)
      );

      // Verify all tasks are accumulated
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(6);
      });
    });

    test("should handle initialPage < 1 by defaulting to 1", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          0 // Invalid page
        )
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("page=1"),
          expect.any(Object)
        );
      });
    });
  });

  describe("onPageChange callback", () => {
    test("should call onPageChange when loadMore is invoked", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse([mockTask("1", "Task 1")], 1, true),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse([mockTask("2", "Task 2")], 2, false),
        });
      global.fetch = mockFetch;

      const { result } = renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          1,
          onPageChange
        )
      );

      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(1);
      });

      // Call loadMore
      result.current.loadMore();

      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(2);
      });
    });

    test("should not call onPageChange on initial mount", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          1,
          onPageChange
        )
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // onPageChange should NOT be called on initial mount
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  describe("filter/search/sort changes", () => {
    test("should call onPageChange(1) when filters change after mount", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      const { rerender } = renderHook(
        ({ filters }) =>
          useWorkspaceTasks(
            mockWorkspaceId,
            mockWorkspaceSlug,
            true,
            10,
            false,
            "",
            filters,
            false,
            "updatedAt",
            "desc",
            1,
            onPageChange
          ),
        {
          initialProps: { filters: {} },
        }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // Clear the mock to verify onPageChange is called after mount
      onPageChange.mockClear();

      // Change filters
      rerender({ filters: { status: ["TODO"] } });

      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(1);
      });
    });

    test("should call onPageChange(1) when search changes after mount", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      const { rerender } = renderHook(
        ({ search }) =>
          useWorkspaceTasks(
            mockWorkspaceId,
            mockWorkspaceSlug,
            true,
            10,
            false,
            search,
            {},
            false,
            "updatedAt",
            "desc",
            1,
            onPageChange
          ),
        {
          initialProps: { search: "" },
        }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      onPageChange.mockClear();

      // Change search
      rerender({ search: "test query" });

      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(1);
      });
    });

    test("should call onPageChange(1) when sort changes after mount", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      const { rerender } = renderHook(
        ({ sortBy, sortOrder }) =>
          useWorkspaceTasks(
            mockWorkspaceId,
            mockWorkspaceSlug,
            true,
            10,
            false,
            "",
            {},
            false,
            sortBy,
            sortOrder,
            1,
            onPageChange
          ),
        {
          initialProps: { sortBy: "updatedAt", sortOrder: "desc" },
        }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      onPageChange.mockClear();

      // Change sort
      rerender({ sortBy: "createdAt", sortOrder: "asc" });

      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(1);
      });
    });
  });

  describe("mount guard behavior", () => {
    test("should distinguish initial mount from filter re-renders", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createMockResponse([mockTask("1", "Task 1")], 1, false),
      });
      global.fetch = mockFetch;

      const { rerender } = renderHook(
        ({ filters }) =>
          useWorkspaceTasks(
            mockWorkspaceId,
            mockWorkspaceSlug,
            true,
            10,
            false,
            "",
            filters,
            false,
            "updatedAt",
            "desc",
            1,
            onPageChange
          ),
        {
          initialProps: { filters: {} },
        }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // onPageChange should NOT be called on initial mount
      expect(onPageChange).not.toHaveBeenCalled();

      // Change filters - now onPageChange SHOULD be called
      rerender({ filters: { priority: ["HIGH"] } });

      await waitFor(() => {
        expect(onPageChange).toHaveBeenCalledWith(1);
      });

      // Verify it was called exactly once (not on mount)
      expect(onPageChange).toHaveBeenCalledTimes(1);
    });

    test("should replay pages on mount but not call onPageChange", async () => {
      const onPageChange = vi.fn();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse([mockTask("1", "Task 1")], 1, true),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => createMockResponse([mockTask("2", "Task 2")], 2, false),
        });
      global.fetch = mockFetch;

      const { result } = renderHook(() =>
        useWorkspaceTasks(
          mockWorkspaceId,
          mockWorkspaceSlug,
          true,
          10,
          false,
          "",
          {},
          false,
          "updatedAt",
          "desc",
          2, // Start at page 2
          onPageChange
        )
      );

      // Wait for replay to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      // Verify tasks were accumulated
      await waitFor(() => {
        expect(result.current.tasks).toHaveLength(2);
      });

      // onPageChange should NOT be called during replay
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });
});
