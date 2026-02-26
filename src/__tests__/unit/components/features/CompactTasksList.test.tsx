import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { CompactTasksList } from "@/components/features/CompactTasksList";
import type { FeatureWithDetails } from "@/types/roadmap";
import type { WorkspaceWithAccess } from "@/types/workspace";
import { TaskStatus } from "@prisma/client";
import userEvent from "@testing-library/user-event";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock hooks
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    slug: "test-workspace",
    workspace: {
      id: "workspace-1",
      slug: "test-workspace",
      repositories: [
        { id: "repo-1", name: "repo-one" },
        { id: "repo-2", name: "repo-two" },
      ],
    },
  }),
}));

vi.mock("@/hooks/useTicketMutations", () => ({
  useTicketMutations: () => ({
    updateTicket: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span>Select</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
}));

vi.mock("@/components/tasks/DeploymentStatusBadge", () => ({
  DeploymentStatusBadge: ({ environment }: any) => (
    <div data-testid="deployment-badge">{environment}</div>
  ),
}));

vi.mock("@/components/tasks/PRStatusBadge", () => ({
  PRStatusBadge: ({ url, status }: any) => (
    <div data-testid="pr-badge" data-url={url} data-status={status}>
      PR
    </div>
  ),
}));

vi.mock("@/components/ui/action-menu", () => ({
  ActionMenu: ({ actions }: any) => (
    <div data-testid="action-menu">
      {actions.map((action: any, idx: number) => (
        <button
          key={idx}
          onClick={action.onClick}
          data-testid={`action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/tasks/MiniToggle", () => ({
  MiniToggle: ({ checked, onChange, disabled }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      data-testid="mini-toggle"
    />
  ),
}));

vi.mock("react-hot-toast", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("CompactTasksList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue({
      push: mockPush,
    });
  });

  // Helper to get task titles (not action menu text)
  const getTaskTitles = () => {
    // Find all task containers, then get the title span within each
    const taskContainers = screen.getAllByRole('button', { hidden: true })
      .filter(el => el.getAttribute('data-testid') !== 'button' && el.getAttribute('data-testid') !== 'action-menu')
      .map(el => el.closest('div[class*="cursor-pointer"]'))
      .filter((el, idx, arr) => arr.indexOf(el) === idx && el !== null);
    
    // If no containers found via buttons, try finding by the task title pattern
    if (taskContainers.length === 0) {
      const allTexts = screen.getAllByText(/Task/);
      // Filter out action menu items by checking parent structure
      return allTexts
        .filter(el => !el.closest('[data-testid="action-menu"]'))
        .map(el => el.textContent);
    }
    
    return taskContainers
      .map(container => {
        const titleSpan = container?.querySelector('span.text-sm');
        return titleSpan?.textContent || '';
      })
      .filter(text => text !== '');
  };

  const createMockTask = (overrides: any = {}) => ({
    id: "task-1",
    title: "Test Task",
    status: "TODO" as TaskStatus,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    assignee: null,
    repository: null,
    autoMerge: false,
    prArtifact: null,
    deploymentStatus: null,
    deployedToStagingAt: null,
    deployedToProductionAt: null,
    ...overrides,
  });

  const createMockFeature = (tasks: any[] = []): FeatureWithDetails => ({
    id: "feature-1",
    title: "Test Feature",
    brief: "Test Brief",
    phases: [
      {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        order: 0,
        featureId: "feature-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        tasks,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: "workspace-1",
    createdBy: "user-1",
    requirements: null,
    architecture: null,
    userStories: [],
    whiteboardId: null,
  });

  describe("getTaskRoute helper - Status-based routing", () => {
    test("routes TODO tasks to /tickets/[id]", () => {
      const task = createMockTask({ id: "task-todo", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskCard = screen.getByText("Test Task").closest("div[class*='cursor-pointer']");
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tickets/task-todo");
    });

    test("routes IN_PROGRESS tasks to /task/[id]", () => {
      const task = createMockTask({ id: "task-in-progress", status: "IN_PROGRESS" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskCard = screen.getByText("Test Task").closest("div[class*='cursor-pointer']");
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/task-in-progress");
    });

    test("routes DONE tasks to /task/[id]", () => {
      const task = createMockTask({ id: "task-done", status: "DONE" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskCard = screen.getByText("Test Task").closest("div[class*='cursor-pointer']");
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/task-done");
    });

    test("routes CANCELLED tasks to /tickets/[id]", () => {
      const task = createMockTask({ id: "task-cancelled", status: "CANCELLED" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskCard = screen.getByText("Test Task").closest("div[class*='cursor-pointer']");
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tickets/task-cancelled");
    });

    test("routes BLOCKED tasks to /tickets/[id]", () => {
      const task = createMockTask({ id: "task-blocked", status: "BLOCKED" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskCard = screen.getByText("Test Task").closest("div[class*='cursor-pointer']");
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tickets/task-blocked");
    });
  });

  describe("Action menu - View Task routing", () => {
    test("View Task action routes TODO to /tickets/[id]", () => {
      const task = createMockTask({ id: "task-todo", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const viewTaskButton = screen.getByTestId("action-view-task");
      viewTaskButton.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tickets/task-todo");
    });

    test("View Task action routes IN_PROGRESS to /task/[id]", () => {
      const task = createMockTask({ id: "task-in-progress", status: "IN_PROGRESS" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const viewTaskButton = screen.getByTestId("action-view-task");
      viewTaskButton.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/task-in-progress");
    });

    test("View Task action routes DONE to /task/[id]", () => {
      const task = createMockTask({ id: "task-done", status: "DONE" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const viewTaskButton = screen.getByTestId("action-view-task");
      viewTaskButton.click();

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/task-done");
    });
  });

  describe("Stable sort order by createdAt", () => {
    test("sorts tasks by createdAt ascending (oldest first)", () => {
      const task1 = createMockTask({
        id: "task-1",
        title: "First Task",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-10"),
      });
      const task2 = createMockTask({
        id: "task-2",
        title: "Second Task",
        createdAt: new Date("2024-01-02"),
        updatedAt: new Date("2024-01-05"),
      });
      const task3 = createMockTask({
        id: "task-3",
        title: "Third Task",
        createdAt: new Date("2024-01-03"),
        updatedAt: new Date("2024-01-15"),
      });

      const feature = createMockFeature([task3, task1, task2]); // Unordered

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const taskTitles = getTaskTitles();
      expect(taskTitles).toEqual(["First Task", "Second Task", "Third Task"]);
    });

    test("order remains stable when updatedAt changes", () => {
      const task1 = createMockTask({
        id: "task-1",
        title: "Task A",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      });
      const task2 = createMockTask({
        id: "task-2",
        title: "Task B",
        createdAt: new Date("2024-01-02"),
        updatedAt: new Date("2024-01-03"),
      });

      const feature = createMockFeature([task1, task2]);

      const { rerender } = render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const initialOrder = getTaskTitles();
      expect(initialOrder).toEqual(["Task A", "Task B"]);

      // Update task2's updatedAt to be later than task1
      const updatedTask2 = {
        ...task2,
        updatedAt: new Date("2024-01-20"), // Much later
      };
      const updatedFeature = createMockFeature([task1, updatedTask2]);

      rerender(
        <CompactTasksList
          feature={updatedFeature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const newOrder = getTaskTitles();
      expect(newOrder).toEqual(["Task A", "Task B"]); // Order unchanged
    });

    test("order remains stable when autoMerge is toggled", () => {
      const task1 = createMockTask({
        id: "task-1",
        title: "Task X",
        createdAt: new Date("2024-01-01"),
        autoMerge: false,
      });
      const task2 = createMockTask({
        id: "task-2",
        title: "Task Y",
        createdAt: new Date("2024-01-02"),
        autoMerge: false,
      });

      const feature = createMockFeature([task1, task2]);

      const { rerender } = render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const initialOrder = getTaskTitles();
      expect(initialOrder).toEqual(["Task X", "Task Y"]);

      // Toggle autoMerge on task2
      const updatedTask2 = {
        ...task2,
        autoMerge: true,
        updatedAt: new Date("2024-01-20"), // updatedAt changes
      };
      const updatedFeature = createMockFeature([task1, updatedTask2]);

      rerender(
        <CompactTasksList
          feature={updatedFeature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const newOrder = getTaskTitles();
      expect(newOrder).toEqual(["Task X", "Task Y"]); // Order unchanged
    });

    test("order remains stable when status changes via real-time event", () => {
      const task1 = createMockTask({
        id: "task-1",
        title: "Task Alpha",
        createdAt: new Date("2024-01-01"),
        status: "TODO",
      });
      const task2 = createMockTask({
        id: "task-2",
        title: "Task Beta",
        createdAt: new Date("2024-01-02"),
        status: "TODO",
      });

      const feature = createMockFeature([task1, task2]);

      const { rerender } = render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const initialOrder = getTaskTitles();
      expect(initialOrder).toEqual(["Task Alpha", "Task Beta"]);

      // Simulate real-time status update
      const updatedTask1 = {
        ...task1,
        status: "IN_PROGRESS" as TaskStatus,
        updatedAt: new Date("2024-01-25"), // Much later
      };
      const updatedFeature = createMockFeature([updatedTask1, task2]);

      rerender(
        <CompactTasksList
          feature={updatedFeature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const newOrder = getTaskTitles();
      expect(newOrder).toEqual(["Task Alpha", "Task Beta"]); // Order unchanged
    });
  });

  describe("Edge cases", () => {
    test("handles empty task list", () => {
      const feature = createMockFeature([]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
    });

    test("handles tasks with same createdAt timestamp", () => {
      const sameDate = new Date("2024-01-01");
      const task1 = createMockTask({
        id: "task-1",
        title: "Task 1",
        createdAt: sameDate,
      });
      const task2 = createMockTask({
        id: "task-2",
        title: "Task 2",
        createdAt: sameDate,
      });

      const feature = createMockFeature([task2, task1]);

      render(
        <CompactTasksList
          feature={feature}
          workspace={{} as WorkspaceWithAccess}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      // Should maintain array order when timestamps are equal
      const taskTitles = getTaskTitles();
      expect(taskTitles.length).toBe(2);
    });
  });
});
