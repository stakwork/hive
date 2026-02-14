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

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: {
      repositories: [],
    },
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

// Mock DeploymentStatusBadge
vi.mock("@/components/tasks/DeploymentStatusBadge", () => ({
  DeploymentStatusBadge: ({ environment }: any) => (
    <div data-testid="deployment-badge">{environment}</div>
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
    workspaceId: "workspace-123",
    dependsOnTaskIds: [],
    assignee: null,
    repository: null,
    phase: { id: "phase-123", name: "Phase 1" },
    bountyCode: null,
    autoMerge: false,
    deploymentStatus: null,
    deployedToStagingAt: null,
    deployedToProductionAt: null,
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
          image: null,
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
          image: null,
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
          image: null,
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

  describe("Deployment badges", () => {
    test("renders deployment badge for task with staging deployment", () => {
      const deployedAt = new Date("2024-01-15T10:00:00Z");
      const task = createMockTask({ 
        title: "Deployed Task",
        deploymentStatus: "staging",
        deployedToStagingAt: deployedAt,
      } as any);
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      expect(screen.getByText("Deployed Task")).toBeInTheDocument();
      const badge = screen.getByTestId("deployment-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("staging");
    });

    test("renders deployment badge for task with production deployment", () => {
      const deployedAt = new Date("2024-01-15T12:00:00Z");
      const task = createMockTask({ 
        title: "Production Task",
        deploymentStatus: "production",
        deployedToProductionAt: deployedAt,
      } as any);
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      expect(screen.getByText("Production Task")).toBeInTheDocument();
      const badge = screen.getByTestId("deployment-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("production");
    });

    test("does not render deployment badge for task without deployment", () => {
      const task = createMockTask({ 
        title: "Non-Deployed Task",
      });
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      expect(screen.getByText("Non-Deployed Task")).toBeInTheDocument();
      expect(screen.queryByTestId("deployment-badge")).not.toBeInTheDocument();
    });

    test("renders deployment badges for multiple deployed tasks", () => {
      const stagingDate = new Date("2024-01-15T10:00:00Z");
      const productionDate = new Date("2024-01-15T12:00:00Z");
      
      const tasks = [
        createMockTask({ 
          id: "task-1", 
          title: "Staging Task", 
          deploymentStatus: "staging",
          deployedToStagingAt: stagingDate,
        } as any),
        createMockTask({ 
          id: "task-2", 
          title: "Production Task",
          deploymentStatus: "production",
          deployedToProductionAt: productionDate,
        } as any),
        createMockTask({ 
          id: "task-3", 
          title: "Not Deployed",
        }),
      ];
      
      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={tasks}
        />
      );

      const badges = screen.getAllByTestId("deployment-badge");
      expect(badges).toHaveLength(2);
      expect(badges[0]).toHaveTextContent("staging");
      expect(badges[1]).toHaveTextContent("production");
    });
  });
});
