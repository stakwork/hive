/**
 * Integration test for deployment badge display in task lists
 * 
 * Tests that deployment badges appear correctly in RoadmapTasksTable
 * after GitHub deployment webhooks are received.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { RoadmapTasksTable } from "@/components/features/RoadmapTasksTable";
import type { TicketListItem } from "@/types/roadmap";
import type { TaskStatus, Priority } from "@prisma/client";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock hooks
vi.mock("@/hooks/useReorderRoadmapTasks", () => ({
  useReorderRoadmapTasks: () => ({
    reorderTasks: vi.fn(),
    isReordering: false,
  }),
}));

vi.mock("@/hooks/useRoadmapTaskMutations", () => ({
  useRoadmapTaskMutations: () => ({
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    isUpdating: false,
    isDeleting: false,
  }),
}));

// Mock dnd-kit
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  closestCenter: vi.fn(),
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
  verticalListSortingStrategy: vi.fn(),
  arrayMove: (arr: any[], from: number, to: number) => {
    const newArr = [...arr];
    const [item] = newArr.splice(from, 1);
    newArr.splice(to, 0, item);
    return newArr;
  },
}));

// Mock UI components
vi.mock("@/components/ui/table", () => ({
  Table: ({ children, ...props }: any) => <table {...props}>{children}</table>,
  TableHeader: ({ children, ...props }: any) => <thead {...props}>{children}</thead>,
  TableBody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <div onClick={onClick}>{children}</div>
  ),
}));

vi.mock("@/components/features/AssigneeCombobox", () => ({
  AssigneeCombobox: ({ currentAssignee }: any) => (
    <div data-testid="assignee-combobox">{currentAssignee?.name || "Unassigned"}</div>
  ),
}));

vi.mock("@/components/features/DependenciesCombobox", () => ({
  DependenciesCombobox: () => <div data-testid="dependencies-combobox">Dependencies</div>,
}));

vi.mock("@/components/features/StatusPopover", () => ({
  StatusPopover: ({ currentStatus }: any) => (
    <div data-testid="status-popover">{currentStatus}</div>
  ),
}));

vi.mock("@/components/features/PriorityPopover", () => ({
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

describe("Deployment Badge Display in Task Lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  test("displays deployment badge for task deployed to staging", async () => {
    const deployedAt = new Date("2024-01-15T10:00:00Z");
    const task = createMockTask({
      title: "Staging Deployed Task",
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

    await waitFor(() => {
      expect(screen.getByText("Staging Deployed Task")).toBeInTheDocument();
      expect(screen.getByTestId("deployment-badge")).toBeInTheDocument();
    });
  });

  test("displays deployment badge for task deployed to production", async () => {
    const deployedAt = new Date("2024-01-15T12:00:00Z");
    const task = createMockTask({
      title: "Production Deployed Task",
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

    await waitFor(() => {
      expect(screen.getByText("Production Deployed Task")).toBeInTheDocument();
      expect(screen.getByTestId("deployment-badge")).toBeInTheDocument();
    });
  });

  test("displays correct deployment status after webhook updates", async () => {
    const stagingDate = new Date("2024-01-15T10:00:00Z");
    const productionDate = new Date("2024-01-15T14:00:00Z");
    
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Task in Staging",
        deploymentStatus: "staging",
        deployedToStagingAt: stagingDate,
      } as any),
      createMockTask({
        id: "task-2",
        title: "Task in Production",
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

    await waitFor(() => {
      // Should have 2 deployment badges
      const badges = screen.getAllByTestId("deployment-badge");
      expect(badges).toHaveLength(2);
      
      // Should show both staging and production tasks
      expect(screen.getByText("Task in Staging")).toBeInTheDocument();
      expect(screen.getByText("Task in Production")).toBeInTheDocument();
      expect(screen.getByText("Not Deployed")).toBeInTheDocument();
    });
  });

  test("does not display deployment badge for non-deployed tasks", async () => {
    const task = createMockTask({
      title: "Not Deployed Task",
      deploymentStatus: null,
    } as any);

    render(
      <RoadmapTasksTable
        phaseId="phase-123"
        workspaceSlug="test-workspace"
        tasks={[task]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Not Deployed Task")).toBeInTheDocument();
      expect(screen.queryByTestId("deployment-badge")).not.toBeInTheDocument();
    });
  });

  test("displays multiple deployment badges in task list", async () => {
    const tasks = [
      createMockTask({
        id: "task-1",
        title: "Task A",
        deploymentStatus: "staging",
        deployedToStagingAt: new Date(),
      } as any),
      createMockTask({
        id: "task-2",
        title: "Task B",
        deploymentStatus: "production",
        deployedToProductionAt: new Date(),
      } as any),
      createMockTask({
        id: "task-3",
        title: "Task C",
        deploymentStatus: "staging",
        deployedToStagingAt: new Date(),
      } as any),
    ];

    render(
      <RoadmapTasksTable
        phaseId="phase-123"
        workspaceSlug="test-workspace"
        tasks={tasks}
      />
    );

    await waitFor(() => {
      const badges = screen.getAllByTestId("deployment-badge");
      expect(badges).toHaveLength(3);
    });
  });
});
