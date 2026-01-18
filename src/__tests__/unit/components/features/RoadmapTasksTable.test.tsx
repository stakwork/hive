import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { RoadmapTasksTable } from "@/components/features/RoadmapTasksTable";
import type { TicketListItem } from "@/types/roadmap";
import { TaskStatus, Priority } from "@prisma/client";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock hooks
vi.mock("@/hooks/useReorderRoadmapTasks", () => ({
  useReorderRoadmapTasks: () => ({
    sensors: [],
    taskIds: [],
    handleDragEnd: vi.fn(),
    collisionDetection: vi.fn(),
  }),
}));

vi.mock("@/hooks/useRoadmapTaskMutations", () => ({
  useRoadmapTaskMutations: () => ({
    updateTicket: vi.fn(),
  }),
}));

// Mock dnd-kit
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}));

// Mock UI components to simplify testing
vi.mock("@/components/features/AssigneeCombobox", () => ({
  AssigneeCombobox: ({ currentAssignee }: any) => (
    <div data-testid="assignee-combobox">{currentAssignee?.name || "Unassigned"}</div>
  ),
}));

vi.mock("@/components/features/DependenciesCombobox", () => ({
  DependenciesCombobox: () => <div data-testid="dependencies-combobox">Dependencies</div>,
}));

vi.mock("@/components/ui/status-popover", () => ({
  StatusPopover: ({ currentStatus }: any) => (
    <div data-testid="status-popover">{currentStatus}</div>
  ),
}));

vi.mock("@/components/ui/priority-popover", () => ({
  PriorityPopover: ({ currentPriority }: any) => (
    <div data-testid="priority-popover">{currentPriority}</div>
  ),
}));

describe("RoadmapTasksTable", () => {
  const mockRouter = {
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue(mockRouter);
    // Mock window.location for currentPath
    Object.defineProperty(window, "location", {
      value: {
        pathname: "/w/test-workspace/plan/feature-123",
        search: "",
      },
      writable: true,
    });
  });

  const createMockTask = (overrides: Partial<TicketListItem> = {}): TicketListItem => ({
    id: "task-123",
    title: "Test Task",
    description: "Test Description",
    status: "TODO" as TaskStatus,
    priority: "MEDIUM" as Priority,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    phaseId: "phase-123",
    featureId: "feature-123",
    dependsOnTaskIds: [],
    assignee: null,
    bountyCode: null,
    ...overrides,
  });

  describe("ActionMenu for TODO tasks", () => {
    test("renders only 'Start Task' action for TODO tasks", async () => {
      const todoTask = createMockTask({ status: "TODO" });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[todoTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        // Should see "Start Task" but not "View Task"
        await waitFor(() => {
          expect(screen.queryByText("Start Task")).toBeInTheDocument();
          expect(screen.queryByText("View Task")).not.toBeInTheDocument();
        });
      }
    });

    test("does NOT render 'View Task' action for TODO tasks", async () => {
      const todoTask = createMockTask({ status: "TODO" });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[todoTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).not.toBeInTheDocument();
        });
      }
    });
  });

  describe("ActionMenu for non-TODO tasks", () => {
    test("renders 'View Task' action for IN_PROGRESS tasks", async () => {
      const inProgressTask = createMockTask({ 
        status: "IN_PROGRESS" as TaskStatus,
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[inProgressTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).toBeInTheDocument();
        });
      }
    });

    test("renders 'View Task' action for DONE tasks", async () => {
      const doneTask = createMockTask({ 
        status: "DONE" as TaskStatus,
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[doneTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).toBeInTheDocument();
        });
      }
    });

    test("renders 'View Task' action for BLOCKED tasks", async () => {
      const blockedTask = createMockTask({ 
        status: "BLOCKED" as TaskStatus,
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[blockedTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).toBeInTheDocument();
        });
      }
    });

    test("clicking 'View Task' navigates to correct URL", async () => {
      const inProgressTask = createMockTask({ 
        id: "task-456",
        status: "IN_PROGRESS" as TaskStatus,
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[inProgressTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        const viewTaskButton = await screen.findByText("View Task");
        await userEvent.click(viewTaskButton);
        
        await waitFor(() => {
          expect(mockRouter.push).toHaveBeenCalledWith("/w/test-workspace/task/task-456");
        });
      }
    });
  });

  describe("ActionMenu for bounty tasks", () => {
    test("renders both 'View Task' AND 'View Bounty' for bounty tasks with status !== TODO", async () => {
      const bountyTask = createMockTask({ 
        status: "IN_PROGRESS" as TaskStatus,
        assignee: {
          id: "system:bounty-hunter",
          name: "Bounty Hunter",
          email: "",
        },
        bountyCode: "BOUNTY123",
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[bountyTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).toBeInTheDocument();
          expect(screen.queryByText("View Bounty")).toBeInTheDocument();
        });
      }
    });
  });

  describe("ActionMenu for regular non-TODO tasks", () => {
    test("renders both 'View Task' AND 'Delete' for regular non-TODO tasks", async () => {
      const regularTask = createMockTask({ 
        status: "IN_PROGRESS" as TaskStatus,
        assignee: {
          id: "user-123",
          name: "Regular User",
          email: "user@example.com",
        },
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[regularTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Task")).toBeInTheDocument();
          expect(screen.queryByText("Delete")).toBeInTheDocument();
        });
      }
    });

    test("does NOT render 'View Bounty' for regular non-bounty tasks", async () => {
      const regularTask = createMockTask({ 
        status: "IN_PROGRESS" as TaskStatus,
        assignee: {
          id: "user-123",
          name: "Regular User",
          email: "user@example.com",
        },
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[regularTask]}
        />
      );

      // Find the action menu button and click it
      const actionMenuButtons = screen.getAllByRole("button");
      const actionMenuButton = actionMenuButtons.find(btn => 
        btn.getAttribute("aria-haspopup") === "menu"
      );
      
      if (actionMenuButton) {
        await userEvent.click(actionMenuButton);
        
        await waitFor(() => {
          expect(screen.queryByText("View Bounty")).not.toBeInTheDocument();
        });
      }
    });
  });

  describe("Empty state", () => {
    test("renders empty state when no tasks are provided", () => {
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[]}
        />
      );

      expect(screen.getByText("No tasks in this phase yet.")).toBeInTheDocument();
    });
  });

  describe("Task rendering", () => {
    test("renders task title", () => {
      const task = createMockTask({ title: "My Custom Task" });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      expect(screen.getByText("My Custom Task")).toBeInTheDocument();
    });

    test("renders multiple tasks", () => {
      const tasks = [
        createMockTask({ id: "task-1", title: "Task 1", order: 0 }),
        createMockTask({ id: "task-2", title: "Task 2", order: 1 }),
        createMockTask({ id: "task-3", title: "Task 3", order: 2 }),
      ];
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={tasks}
        />
      );

      expect(screen.getByText("Task 1")).toBeInTheDocument();
      expect(screen.getByText("Task 2")).toBeInTheDocument();
      expect(screen.getByText("Task 3")).toBeInTheDocument();
    });
  });
});
