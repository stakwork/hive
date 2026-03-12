import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TasksList } from "@/components/tasks/TasksList";
import * as useWorkspaceTasksModule from "@/hooks/useWorkspaceTasks";
import * as useTaskStatsModule from "@/hooks/useTaskStats";
import * as useWorkspaceModule from "@/hooks/useWorkspace";

// Mock the hooks
vi.mock("@/hooks/useWorkspaceTasks");
vi.mock("@/hooks/useTaskStats");
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: any) => value,
}));

// Mock Next.js router
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/test-workspace/tasks",
  useSearchParams: () => mockSearchParams,
}));

// Mock TaskCard component
vi.mock("@/components/tasks/TaskCard", () => ({
  TaskCard: ({ task }: any) => <div data-testid={`task-card-${task.id}`}>{task.title}</div>,
}));

// Mock EmptyState component
vi.mock("@/components/tasks/empty-state", () => ({
  EmptyState: () => <div>Create your first task</div>,
}));

// Mock LoadingState component
vi.mock("@/components/tasks/LoadingState", () => ({
  LoadingState: () => <div>Loading...</div>,
}));

// Mock TaskFilters component
vi.mock("@/components/tasks/TaskFilters", () => ({
  TaskFilters: ({ filters, onFiltersChange, onClearFilters }: any) => (
    <div data-testid="task-filters">Filters</div>
  ),
}));

// Mock KanbanView component - captures columns for testing
vi.mock("@/components/ui/kanban-view", () => ({
  KanbanView: ({ items, columns, getItemStatus, renderCard }: any) => (
    <div data-testid="kanban-view">
      {columns.map((col: any) => (
        <div key={col.status} data-testid={`kanban-column-${col.status}`}>
          <span data-testid={`kanban-column-title-${col.status}`}>{col.title}</span>
          {items
            .filter((item: any) => getItemStatus(item) === col.status)
            .map((item: any) => (
              <div key={item.id}>{renderCard(item)}</div>
            ))}
        </div>
      ))}
    </div>
  ),
}));

const mockTasks = [
  {
    id: "task-1",
    title: "First Task",
    status: "IN_PROGRESS" as const,
    createdAt: "2024-01-01T10:00:00Z",
    updatedAt: "2024-01-15T10:00:00Z",
    hasActionArtifact: false,
  },
  {
    id: "task-2",
    title: "Second Task",
    status: "TODO" as const,
    createdAt: "2024-01-05T10:00:00Z",
    updatedAt: "2024-01-20T10:00:00Z",
    hasActionArtifact: false,
  },
  {
    id: "task-3",
    title: "Third Task",
    status: "DONE" as const,
    createdAt: "2024-01-10T10:00:00Z",
    updatedAt: "2024-01-10T10:00:00Z",
    hasActionArtifact: false,
  },
  {
    id: "task-4",
    title: "Fourth Task",
    status: "TODO" as const,
    createdAt: "2024-01-03T10:00:00Z",
    updatedAt: "2024-01-25T10:00:00Z",
    hasActionArtifact: false,
  },
];

describe("TasksList - Sorting Functionality", () => {
  const mockRefetch = vi.fn();
  const mockLoadMore = vi.fn();

  // Helper to get sorted tasks based on sort parameters
  const getSortedTasks = (sortBy: string, sortOrder: string) => {
    const tasksCopy = [...mockTasks];
    tasksCopy.sort((a, b) => {
      const aValue = sortBy === "createdAt" ? new Date(a.createdAt).getTime() : new Date(a.updatedAt).getTime();
      const bValue = sortBy === "createdAt" ? new Date(b.createdAt).getTime() : new Date(b.updatedAt).getTime();
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
    return tasksCopy;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();

    // Setup default mocks
    vi.spyOn(useWorkspaceModule, "useWorkspace").mockReturnValue({
      waitingForInputCount: 0,
    } as any);

    vi.spyOn(useTaskStatsModule, "useTaskStats").mockReturnValue({
      stats: { total: 4, active: 4, archived: 0, queuedCount: 0 },
      loading: false,
    } as any);

    // Mock useWorkspaceTasks to return sorted tasks based on parameters
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockImplementation(
      (workspaceId, workspaceSlug, enabled, pageLimit, showArchived, searchQuery, filters, showAllStatuses, sortBy = "updatedAt", sortOrder = "desc", queue = false) => {
        if (queue) {
          return {
            tasks: [],
            loading: false,
            error: null,
            pagination: { hasMore: false },
            loadMore: mockLoadMore,
            refetch: mockRefetch,
          } as any;
        }
        const sortedTasks = getSortedTasks(sortBy, sortOrder);
        return {
          tasks: sortedTasks,
          loading: false,
          error: null,
          pagination: { hasMore: false },
          loadMore: mockLoadMore,
          refetch: mockRefetch,
        } as any;
      }
    );
  });

  describe("Default Sorting", () => {
    it("should default to 'Updated (Newest)' sorting", async () => {
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Check that the sort select shows the default value
      const sortSelect = screen.getByTestId("sort-select");
      expect(sortSelect).toHaveTextContent("Updated (Newest)");
    });

    it("should sort tasks by updated date descending by default", async () => {
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      const taskCards = screen.getAllByText(/Task/);
      // Expected order: task-4 (Jan 25), task-2 (Jan 20), task-1 (Jan 15), task-3 (Jan 10)
      expect(taskCards[0]).toHaveTextContent("Fourth Task");
      expect(taskCards[1]).toHaveTextContent("Second Task");
      expect(taskCards[2]).toHaveTextContent("First Task");
      expect(taskCards[3]).toHaveTextContent("Third Task");
    });
  });

  describe("Sort Options", () => {
    it("should sort by updated date ascending", async () => {
      localStorage.setItem("tasks-sort-preference", "updatedAsc");
      
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      await waitFor(() => {
        const taskCards = screen.getAllByText(/Task/);
        // Expected order: task-3 (Jan 10), task-1 (Jan 15), task-2 (Jan 20), task-4 (Jan 25)
        expect(taskCards[0]).toHaveTextContent("Third Task");
        expect(taskCards[1]).toHaveTextContent("First Task");
        expect(taskCards[2]).toHaveTextContent("Second Task");
        expect(taskCards[3]).toHaveTextContent("Fourth Task");
      });
    });

    it("should sort by created date descending", async () => {
      localStorage.setItem("tasks-sort-preference", "createdDesc");
      
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      await waitFor(() => {
        const taskCards = screen.getAllByText(/Task/);
        // Expected order: task-3 (Jan 10), task-2 (Jan 5), task-4 (Jan 3), task-1 (Jan 1)
        expect(taskCards[0]).toHaveTextContent("Third Task");
        expect(taskCards[1]).toHaveTextContent("Second Task");
        expect(taskCards[2]).toHaveTextContent("Fourth Task");
        expect(taskCards[3]).toHaveTextContent("First Task");
      });
    });

    it("should sort by created date ascending", async () => {
      localStorage.setItem("tasks-sort-preference", "createdAsc");
      
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      await waitFor(() => {
        const taskCards = screen.getAllByText(/Task/);
        // Expected order: task-1 (Jan 1), task-4 (Jan 3), task-2 (Jan 5), task-3 (Jan 10)
        expect(taskCards[0]).toHaveTextContent("First Task");
        expect(taskCards[1]).toHaveTextContent("Fourth Task");
        expect(taskCards[2]).toHaveTextContent("Second Task");
        expect(taskCards[3]).toHaveTextContent("Third Task");
      });
    });
  });

  describe("LocalStorage Persistence", () => {
    it("should load sort preference from localStorage on mount", async () => {
      localStorage.setItem("tasks-sort-preference", "createdAsc");

      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      const sortSelect = screen.getByTestId("sort-select");
      expect(sortSelect).toHaveTextContent("Created (Oldest)");

      const taskCards = screen.getAllByText(/Task/);
      // Should be sorted by created date ascending
      expect(taskCards[0]).toHaveTextContent("First Task");
      expect(taskCards[1]).toHaveTextContent("Fourth Task");
    });

    it("should default to updatedDesc if localStorage has invalid value", async () => {
      localStorage.setItem("tasks-sort-preference", "invalid-sort");

      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Check that tasks are sorted by updated date descending (the default)
      const taskCards = screen.getAllByText(/Task/);
      // Expected order: task-4 (Jan 25), task-2 (Jan 20), task-1 (Jan 15), task-3 (Jan 10)
      expect(taskCards[0]).toHaveTextContent("Fourth Task");
      expect(taskCards[1]).toHaveTextContent("Second Task");
    });
  });

  describe("Sorting in Different Views", () => {
    it("should apply sorting in list view with localStorage preference", async () => {
      localStorage.setItem("tasks-sort-preference", "createdAsc");
      
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Verify we're in list view (default)
      const listViewButton = screen.getByLabelText("List view");
      expect(listViewButton).toHaveAttribute("data-state", "on");

      const taskCards = screen.getAllByText(/Task/);
      expect(taskCards[0]).toHaveTextContent("First Task");
    });

    it("should apply sorting in kanban view with localStorage preference", async () => {
      localStorage.setItem("tasks-sort-preference", "createdDesc");
      localStorage.setItem("tasks-view-preference", "kanban");
      
      const user = userEvent.setup();
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Should be in kanban view from localStorage
      const kanbanViewButton = screen.getByLabelText("Kanban view");
      expect(kanbanViewButton).toHaveAttribute("data-state", "on");

      // Tasks should be sorted
      const taskCards = screen.getAllByText(/Task/);
      expect(taskCards.length).toBeGreaterThan(0);
    });

    it("should maintain sort preference when switching between views", async () => {
      localStorage.setItem("tasks-sort-preference", "createdAsc");
      
      const user = userEvent.setup();
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Switch to kanban view
      const kanbanViewButton = screen.getByLabelText("Kanban view");
      await user.click(kanbanViewButton);

      await waitFor(() => {
        expect(kanbanViewButton).toHaveAttribute("data-state", "on");
      });

      const sortSelect = screen.getByTestId("sort-select");
      expect(sortSelect).toHaveTextContent("Created (Oldest)");

      // Switch back to list view
      const listViewButton = screen.getByLabelText("List view");
      await user.click(listViewButton);

      await waitFor(() => {
        expect(sortSelect).toHaveTextContent("Created (Oldest)");
        const taskCards = screen.getAllByText(/Task/);
        expect(taskCards[0]).toHaveTextContent("First Task");
      });
    });
  });

  describe("Sorting with Empty State", () => {
    it("should handle empty task list gracefully", async () => {
      vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
        tasks: [],
        loading: false,
        error: null,
        pagination: { hasMore: false },
        loadMore: mockLoadMore,
        refetch: mockRefetch,
      } as any);

      vi.spyOn(useTaskStatsModule, "useTaskStats").mockReturnValue({
        stats: { total: 0, active: 0, archived: 0 },
        loading: false,
      } as any);

      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      // Should show empty state, not crash
      await waitFor(() => {
        expect(screen.queryByText(/Create your first task/)).toBeInTheDocument();
      });
    });
  });

  describe("Sorting with Archived Tasks", () => {
    it("should apply sorting to archived tasks tab", async () => {
      localStorage.setItem("tasks-sort-preference", "createdDesc");
      
      const user = userEvent.setup();
      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      // Switch to archived tab
      const archivedTab = screen.getByRole("tab", { name: /archived/i });
      await user.click(archivedTab);

      await waitFor(() => {
        const sortSelect = screen.getByTestId("sort-select");
        expect(sortSelect).toHaveTextContent("Created (Newest)");
      });
    });
  });

  describe("Integration with Search and Filters", () => {
    it("should apply sorting to filtered results", async () => {
      localStorage.setItem("tasks-sort-preference", "createdAsc");
      
      const filteredTasks = [mockTasks[0], mockTasks[2]]; // Only tasks 1 and 3

      vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
        tasks: filteredTasks,
        loading: false,
        error: null,
        pagination: { hasMore: false },
        loadMore: mockLoadMore,
        refetch: mockRefetch,
      } as any);

      render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

      await waitFor(() => {
        expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
      });

      const taskCards = screen.getAllByText(/Task/);
      // task-1 (Jan 1) should come before task-3 (Jan 10)
      expect(taskCards[0]).toHaveTextContent("First Task");
      expect(taskCards[1]).toHaveTextContent("Third Task");
    });
  });
});

const workflowTasks = [
  {
    id: "wf-task-1",
    title: "Workflow Task A",
    status: "IN_PROGRESS" as const,
    mode: "workflow_editor",
    createdAt: "2024-02-01T10:00:00Z",
    updatedAt: "2024-02-15T10:00:00Z",
    hasActionArtifact: false,
  },
  {
    id: "regular-task-1",
    title: "Regular Task B",
    status: "TODO" as const,
    mode: undefined,
    createdAt: "2024-02-05T10:00:00Z",
    updatedAt: "2024-02-20T10:00:00Z",
    hasActionArtifact: false,
  },
];

describe("TasksList - Workflows Kanban Column", () => {
  const mockRefetch = vi.fn();
  const mockLoadMore = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("tasks-view-preference", "kanban");

    vi.spyOn(useWorkspaceModule, "useWorkspace").mockReturnValue({
      waitingForInputCount: 0,
    } as any);

    vi.spyOn(useTaskStatsModule, "useTaskStats").mockReturnValue({
      stats: { total: 2, active: 2, archived: 0, queuedCount: 0 },
      loading: false,
    } as any);
  });

  it("shows Workflows column when workspaceSlug is 'stakwork' and workflow_editor tasks exist", async () => {
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
      tasks: workflowTasks,
      loading: false,
      error: null,
      pagination: { hasMore: false },
      loadMore: mockLoadMore,
      refetch: mockRefetch,
    } as any);

    render(<TasksList workspaceId="workspace-1" workspaceSlug="stakwork" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    expect(screen.getByTestId("kanban-column-WORKFLOW_EDITOR")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-title-WORKFLOW_EDITOR")).toHaveTextContent("Workflows");
  });

  it("puts workflow_editor tasks only in the Workflows column on stakwork workspace", async () => {
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
      tasks: workflowTasks,
      loading: false,
      error: null,
      pagination: { hasMore: false },
      loadMore: mockLoadMore,
      refetch: mockRefetch,
    } as any);

    render(<TasksList workspaceId="workspace-1" workspaceSlug="stakwork" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    const workflowColumn = screen.getByTestId("kanban-column-WORKFLOW_EDITOR");
    expect(within(workflowColumn).getByTestId("task-card-wf-task-1")).toBeInTheDocument();

    // Regular task must NOT appear in Workflows column
    expect(within(workflowColumn).queryByTestId("task-card-regular-task-1")).not.toBeInTheDocument();

    // Regular task must appear in its normal status column (TODO)
    const todoColumn = screen.getByTestId("kanban-column-TODO");
    expect(within(todoColumn).getByTestId("task-card-regular-task-1")).toBeInTheDocument();
  });

  it("does NOT show Workflows column on stakwork workspace when no workflow_editor tasks exist", async () => {
    const nonWorkflowTasks = [
      {
        id: "reg-1",
        title: "Regular Task",
        status: "TODO" as const,
        mode: undefined,
        createdAt: "2024-02-01T10:00:00Z",
        updatedAt: "2024-02-15T10:00:00Z",
        hasActionArtifact: false,
      },
    ];

    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
      tasks: nonWorkflowTasks,
      loading: false,
      error: null,
      pagination: { hasMore: false },
      loadMore: mockLoadMore,
      refetch: mockRefetch,
    } as any);

    render(<TasksList workspaceId="workspace-1" workspaceSlug="stakwork" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("kanban-column-WORKFLOW_EDITOR")).not.toBeInTheDocument();
  });

  it("does NOT show Workflows column on non-stakwork workspace even when workflow_editor tasks exist", async () => {
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
      tasks: workflowTasks,
      loading: false,
      error: null,
      pagination: { hasMore: false },
      loadMore: mockLoadMore,
      refetch: mockRefetch,
    } as any);

    render(<TasksList workspaceId="workspace-1" workspaceSlug="other-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("kanban-column-WORKFLOW_EDITOR")).not.toBeInTheDocument();
  });

  it("places workflow_editor tasks in their normal status column on non-stakwork workspace", async () => {
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockReturnValue({
      tasks: workflowTasks,
      loading: false,
      error: null,
      pagination: { hasMore: false },
      loadMore: mockLoadMore,
      refetch: mockRefetch,
    } as any);

    render(<TasksList workspaceId="workspace-1" workspaceSlug="other-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    // workflow_editor task has status IN_PROGRESS, so it should appear there
    const inProgressColumn = screen.getByTestId("kanban-column-IN_PROGRESS");
    expect(within(inProgressColumn).getByTestId("task-card-wf-task-1")).toBeInTheDocument();
  });
});

describe("TasksList - Queue Tab", () => {
  const mockRefetch = vi.fn();
  const mockLoadMore = vi.fn();

  const queuedTaskMocks = [
    {
      id: "queued-1",
      title: "Queued Task One",
      status: "TODO" as const,
      systemAssigneeType: "TASK_COORDINATOR" as const,
      priority: "CRITICAL" as const,
      createdAt: "2024-01-01T10:00:00Z",
      updatedAt: "2024-01-01T10:00:00Z",
      hasActionArtifact: false,
    },
    {
      id: "queued-2",
      title: "Queued Task Two",
      status: "TODO" as const,
      systemAssigneeType: "TASK_COORDINATOR" as const,
      priority: "HIGH" as const,
      createdAt: "2024-01-02T10:00:00Z",
      updatedAt: "2024-01-02T10:00:00Z",
      hasActionArtifact: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams = new URLSearchParams();

    vi.spyOn(useWorkspaceModule, "useWorkspace").mockReturnValue({
      waitingForInputCount: 0,
    } as any);

    vi.spyOn(useTaskStatsModule, "useTaskStats").mockReturnValue({
      stats: { total: 4, active: 4, archived: 0, queuedCount: 2 },
      loading: false,
    } as any);

    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockImplementation(
      (_workspaceId, _workspaceSlug, _enabled, _pageLimit, _showArchived, _search, _filters, _showAllStatuses, _sortBy, _sortOrder, queue = false) => {
        if (queue) {
          return {
            tasks: queuedTaskMocks,
            loading: false,
            error: null,
            pagination: { hasMore: false },
            loadMore: mockLoadMore,
            refetch: mockRefetch,
          } as any;
        }
        return {
          tasks: mockTasks,
          loading: false,
          error: null,
          pagination: { hasMore: false },
          loadMore: mockLoadMore,
          refetch: mockRefetch,
        } as any;
      }
    );
  });

  it("should render tabs in Queue, Active, Archived order", async () => {
    render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    const tabs = screen.getAllByRole("tab");
    const tabNames = tabs.map((t) => t.textContent?.trim());
    const queueIdx = tabNames.findIndex((n) => n?.includes("Queue"));
    const activeIdx = tabNames.findIndex((n) => n === "Active");
    const archivedIdx = tabNames.findIndex((n) => n === "Archived");

    expect(queueIdx).toBeLessThan(activeIdx);
    expect(activeIdx).toBeLessThan(archivedIdx);
  });

  it("should initialise to Queue tab when ?tab=queue URL param is present", async () => {
    mockSearchParams = new URLSearchParams("tab=queue");

    render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks-list-loaded")).toBeInTheDocument();
    });

    const queueTab = screen.getByTestId("queue-tab");
    expect(queueTab).toHaveAttribute("data-state", "active");
  });

  it("should show queued tasks when Queue tab is active", async () => {
    mockSearchParams = new URLSearchParams("tab=queue");

    render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("queue-tab-content")).toBeInTheDocument();
    });

    expect(screen.getByTestId("task-card-queued-1")).toBeInTheDocument();
    expect(screen.getByTestId("task-card-queued-2")).toBeInTheDocument();
  });

  it("should use queued tasks in kanban view when Queue tab is active", async () => {
    localStorage.setItem("tasks-view-preference", "kanban");
    mockSearchParams = new URLSearchParams("tab=queue");

    render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("kanban-view")).toBeInTheDocument();
    });

    const queueColumn = screen.getByTestId("kanban-column-QUEUE");
    expect(within(queueColumn).getByTestId("task-card-queued-1")).toBeInTheDocument();
    expect(within(queueColumn).getByTestId("task-card-queued-2")).toBeInTheDocument();
    expect(within(queueColumn).queryByTestId("task-card-task-1")).not.toBeInTheDocument();
  });

  it("should show empty state when no tasks are queued", async () => {
    vi.spyOn(useWorkspaceTasksModule, "useWorkspaceTasks").mockImplementation(
      (_workspaceId, _workspaceSlug, _enabled, _pageLimit, _showArchived, _search, _filters, _showAllStatuses, _sortBy, _sortOrder, queue = false) => {
        if (queue) {
          return {
            tasks: [],
            loading: false,
            error: null,
            pagination: { hasMore: false },
            loadMore: mockLoadMore,
            refetch: mockRefetch,
          } as any;
        }
        return {
          tasks: mockTasks,
          loading: false,
          error: null,
          pagination: { hasMore: false },
          loadMore: mockLoadMore,
          refetch: mockRefetch,
        } as any;
      }
    );

    mockSearchParams = new URLSearchParams("tab=queue");

    render(<TasksList workspaceId="workspace-1" workspaceSlug="test-workspace" />);

    await waitFor(() => {
      expect(screen.getByTestId("queue-empty-state")).toBeInTheDocument();
    });

    expect(screen.getByText("No tasks in queue")).toBeInTheDocument();
  });
});
