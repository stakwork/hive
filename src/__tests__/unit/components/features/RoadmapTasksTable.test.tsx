import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { RoadmapTasksTable } from "@/components/features/RoadmapTasksTable";
import type { TicketListItem } from "@/types/roadmap";
import { TaskStatus, Priority } from "@prisma/client";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(() => "/w/test-workspace/plan/test-feature"),
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

const mockUpdateTicket = vi.fn();
vi.mock("@/hooks/useRoadmapTaskMutations", () => ({
  useRoadmapTaskMutations: () => ({
    updateTicket: mockUpdateTicket,
  }),
}));

const mockWorkspaceRepositories: Array<{ id: string; name: string; repositoryUrl: string; allowAutoMerge: boolean }> = [];

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: {
      repositories: mockWorkspaceRepositories,
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
    mockUpdateTicket.mockResolvedValue(null);
    (useRouter as any).mockReturnValue(mockRouter);
    // Reset workspace repos to empty by default
    mockWorkspaceRepositories.length = 0;
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
    systemAssigneeType: null,
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
          expect(mockRouter.push).toHaveBeenCalledWith("/w/test-workspace/task/task-456?from=%2Fw%2Ftest-workspace%2Fplan%2Ffeature-123");
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

  describe("Auto-merge toggle disabled when repo disallows it", () => {
    test("switch is disabled and tooltip is shown when task repo has allowAutoMerge=false", async () => {
      const user = userEvent.setup();
      const repoId = "repo-no-automerge";
      mockWorkspaceRepositories.push({
        id: repoId,
        name: "my-repo",
        repositoryUrl: "https://github.com/org/my-repo",
        allowAutoMerge: false,
      });

      const task = createMockTask({
        id: "task-disabled",
        autoMerge: false,
        repository: { id: repoId, name: "my-repo", repositoryUrl: "https://github.com/org/my-repo" } as any,
      });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl).toBeDisabled();

      // Tooltip content renders into a Radix portal only after hover
      await user.hover(switchEl);
      await waitFor(() => {
        const tooltips = screen.getAllByText("Enable auto-merge in GitHub repo settings first");
        expect(tooltips.length).toBeGreaterThan(0);
      });
    });

    test("switch is enabled when task repo has allowAutoMerge=true", () => {
      const repoId = "repo-with-automerge";
      mockWorkspaceRepositories.push({
        id: repoId,
        name: "my-repo",
        repositoryUrl: "https://github.com/org/my-repo",
        allowAutoMerge: true,
      });

      const task = createMockTask({
        id: "task-enabled",
        autoMerge: false,
        repository: { id: repoId, name: "my-repo", repositoryUrl: "https://github.com/org/my-repo" } as any,
      });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl).not.toBeDisabled();
      expect(screen.queryByText("Enable auto-merge in GitHub repo settings first")).not.toBeInTheDocument();
    });

    test("switch uses single workspace repo allowAutoMerge when task has no repo assigned", () => {
      mockWorkspaceRepositories.push({
        id: "repo-single",
        name: "only-repo",
        repositoryUrl: "https://github.com/org/only-repo",
        allowAutoMerge: false,
      });

      const task = createMockTask({ id: "task-no-repo", autoMerge: false, repository: null });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl).toBeDisabled();
    });

    test("switch is enabled when no repo context can be determined (multi-repo, no assignment)", () => {
      mockWorkspaceRepositories.push(
        { id: "repo-a", name: "repo-a", repositoryUrl: "https://github.com/org/a", allowAutoMerge: false },
        { id: "repo-b", name: "repo-b", repositoryUrl: "https://github.com/org/b", allowAutoMerge: false },
      );

      const task = createMockTask({ id: "task-multi", autoMerge: false, repository: null });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      // With multi-repo and no assignment, server gate is the fallback → enabled
      const switchEl = screen.getByRole("switch");
      expect(switchEl).not.toBeDisabled();
    });
  });

  describe("toast.error on updateTicket failure", () => {
    test("shows toast.error with server error message and reverts optimistic update", async () => {
      const user = userEvent.setup();
      mockUpdateTicket.mockRejectedValueOnce(new Error("Auto-merge is not allowed on this repository. Enable it in GitHub repository settings."));

      const task = createMockTask({ id: "task-toast", autoMerge: false });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      await user.click(switchEl);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Auto-merge is not allowed on this repository. Enable it in GitHub repository settings."
        );
      });

      // Optimistic update should be reverted (switch back to unchecked)
      await waitFor(() => {
        expect(switchEl).toHaveAttribute("data-state", "unchecked");
      });
    });

    test("shows generic toast.error when error has no message", async () => {
      const user = userEvent.setup();
      mockUpdateTicket.mockRejectedValueOnce("non-error-throw");

      const task = createMockTask({ id: "task-generic-error", autoMerge: false });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      await user.click(switchEl);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Failed to update task");
      });
    });
  });

  describe("Optimistic updates for Auto-Merge switch", () => {
    test("auto-merge switch reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      // Never-resolving promise simulates slow network
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", autoMerge: false });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "unchecked");

      await user.click(switchEl);

      // Should flip immediately, before the promise resolves
      expect(switchEl).toHaveAttribute("data-state", "checked");

      // Clean up
      resolveTicket(null);
    });

    test("auto-merge switch reverts to original value when updateTicket rejects", async () => {
      const user = userEvent.setup();
      mockUpdateTicket.mockRejectedValueOnce(new Error("Network error"));

      const task = createMockTask({ id: "task-revert", status: "TODO", autoMerge: false });

      render(
        <RoadmapTasksTable
          phaseId="phase-123"
          workspaceSlug="test-workspace"
          tasks={[task]}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "unchecked");

      await user.click(switchEl);

      // After rejection, switch should revert to original unchecked state
      await waitFor(() => {
        expect(switchEl).toHaveAttribute("data-state", "unchecked");
      });
    });
  });
});
