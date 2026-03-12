import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { CompactTasksList } from "@/components/features/CompactTasksList";
import type { FeatureWithDetails } from "@/types/roadmap";
import type { WorkspaceWithAccess } from "@/types/workspace";
import { TaskStatus } from "@prisma/client";
import userEvent from "@testing-library/user-event";
import { useIsMobile } from "@/hooks/useIsMobile";

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

vi.mock("@/hooks/useRoadmapTaskMutations", () => ({
  useRoadmapTaskMutations: () => ({
    updateTicket: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}));

vi.mock("@/components/features/DependencyGraph", () => ({
  DependencyGraph: ({ className }: any) => (
    <div data-testid="dependency-graph" className={className} />
  ),
}));

vi.mock("@/components/features/DependencyGraph/nodes", () => ({
  RoadmapTaskNode: ({ data }: any) => <div data-testid="roadmap-task-node">{data.title}</div>,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children, open }: any) => (
    <div data-testid="collapsible" data-open={open}>{children}</div>
  ),
  CollapsibleTrigger: ({ children, asChild }: any) => (
    <div data-testid="collapsible-trigger">{children}</div>
  ),
  CollapsibleContent: ({ children }: any) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
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
  SelectTrigger: ({ children, className }: any) => (
    <div data-testid="select-trigger" className={className}>
      {children}
    </div>
  ),
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
          disabled={action.disabled}
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

vi.mock("sonner", () => ({
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
    systemAssigneeType: null,
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

  describe("Queued indicator", () => {
    test("shows 'Queued' label and pulsing blue dot for TODO task with TASK_COORDINATOR assignee", () => {
      const task = createMockTask({
        id: "task-queued",
        title: "Queued Task",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
      });
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

      // Check for "Queued" label
      expect(screen.getByText("Queued")).toBeInTheDocument();

      // Check for blue pulsing dot
      const taskCard = screen.getByText("Queued Task").closest("div[class*='cursor-pointer']");
      const dot = taskCard?.querySelector(".bg-blue-500.animate-pulse");
      expect(dot).toBeInTheDocument();
    });

    test("does not show 'Queued' label for TODO task without systemAssigneeType", () => {
      const task = createMockTask({
        id: "task-todo",
        title: "Regular TODO Task",
        status: "TODO",
        systemAssigneeType: null,
      });
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

      // Should not show "Queued" label
      expect(screen.queryByText("Queued")).not.toBeInTheDocument();

      // Should show grey dot (bg-zinc-400)
      const taskCard = screen.getByText("Regular TODO Task").closest("div[class*='cursor-pointer']");
      const dot = taskCard?.querySelector(".bg-zinc-400");
      expect(dot).toBeInTheDocument();
    });

    test("does not show 'Queued' label for IN_PROGRESS task with TASK_COORDINATOR assignee", () => {
      const task = createMockTask({
        id: "task-in-progress",
        title: "In Progress Task",
        status: "IN_PROGRESS",
        systemAssigneeType: "TASK_COORDINATOR",
      });
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

      // Should not show "Queued" label
      expect(screen.queryByText("Queued")).not.toBeInTheDocument();

      // Should show amber dot (bg-amber-500)
      const taskCard = screen.getByText("In Progress Task").closest("div[class*='cursor-pointer']");
      const dot = taskCard?.querySelector(".bg-amber-500");
      expect(dot).toBeInTheDocument();
    });
  });

  describe("Start Task action menu item", () => {
    test("shows 'Start Task' in action menu for an unassigned TODO task", () => {
      const task = createMockTask({ id: "task-todo", status: "TODO", systemAssigneeType: null });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByTestId("action-start-task")).toBeInTheDocument();
    });

    test("shows 'Start Task' for a TODO task already queued under TASK_COORDINATOR", () => {
      const task = createMockTask({
        id: "task-queued",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
      });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByTestId("action-start-task")).toBeInTheDocument();
    });

    test("does NOT show 'Start Task' for an IN_PROGRESS task", () => {
      const task = createMockTask({ id: "task-ip", status: "IN_PROGRESS" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.queryByTestId("action-start-task")).not.toBeInTheDocument();
    });

    test("does NOT show 'Start Task' for a DONE task", () => {
      const task = createMockTask({ id: "task-done", status: "DONE" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.queryByTestId("action-start-task")).not.toBeInTheDocument();
    });

    test("calls PATCH /api/tasks/[taskId] with startWorkflow:true on click", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );
      const task = createMockTask({ id: "task-start", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const startBtn = screen.getByTestId("action-start-task");
      startBtn.click();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/tasks/task-start",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ startWorkflow: true }),
          })
        );
      });

      fetchSpy.mockRestore();
    });

    test("shows toast.error when the API returns a non-OK response", async () => {
      const { toast } = await import("sonner");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 500 })
      );
      const task = createMockTask({ id: "task-fail", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      screen.getByTestId("action-start-task").click();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Failed to start task");
      });

      vi.restoreAllMocks();
    });

    test("'Start Task' button is disabled while request is in flight for that task", async () => {
      let resolveRequest!: (value: Response) => void;
      vi.spyOn(globalThis, "fetch").mockReturnValue(
        new Promise<Response>((res) => { resolveRequest = res; })
      );

      const task = createMockTask({ id: "task-loading", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const startBtn = screen.getByTestId("action-start-task");
      startBtn.click();

      // While the fetch is pending, the button should be disabled
      await waitFor(() => {
        expect(screen.getByTestId("action-start-task")).toBeDisabled();
      });

      // Resolve the pending promise so the component can clean up
      resolveRequest(new Response(JSON.stringify({ success: true }), { status: 200 }));
      vi.restoreAllMocks();
    });
  });

  describe("Repo SelectTrigger truncation", () => {
    test("SelectTrigger inner div has overflow-hidden to prevent long repo names wrapping", () => {
      const task = createMockTask({
        id: "task-repo",
        title: "Repo Task",
        status: "TODO",
        repositoryId: "repo-1",
      });
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

      // The SelectTrigger should have max-w-[120px] to constrain width
      const trigger = screen.getByTestId("select-trigger");
      expect(trigger.className).toMatch(/max-w-\[120px\]/);

      // The inner flex container must have overflow-hidden so long names like
      // "sphinx-nav-fiber" don't wrap to a second line
      const innerDiv = trigger.querySelector("div");
      expect(innerDiv?.className).toMatch(/overflow-hidden/);
    });

    test("SelectValue is wrapped in a truncate span to clip long repo names", () => {
      const task = createMockTask({
        id: "task-repo2",
        title: "Repo Task 2",
        status: "TODO",
        repositoryId: "repo-1",
      });
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

      const trigger = screen.getByTestId("select-trigger");
      // The truncate wrapper span must exist inside the trigger
      const truncateSpan = trigger.querySelector("span.truncate");
      expect(truncateSpan).toBeInTheDocument();
    });
  });

  describe("Dependency graph section", () => {
    test("graph section is not rendered when all tasks have empty dependsOnTaskIds", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: [] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.queryByTestId("dependency-graph")).not.toBeInTheDocument();
      expect(screen.queryByTestId("collapsible")).not.toBeInTheDocument();
    });

    test("graph section is not rendered when tasks have no dependsOnTaskIds field", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1" });
      const task2 = createMockTask({ id: "t2" });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.queryByTestId("dependency-graph")).not.toBeInTheDocument();
    });

    test("graph section is rendered when at least one task has a dependency", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: ["t1"] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByTestId("dependency-graph")).toBeInTheDocument();
    });

    test("graphOpen initialises to false (collapsed) by default on desktop", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: ["t1"] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const collapsible = screen.getByTestId("collapsible");
      expect(collapsible).toHaveAttribute("data-open", "false");
    });

    test("graphOpen initialises to false (collapsed) by default on mobile", () => {
      (useIsMobile as any).mockReturnValue(true);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: ["t1"] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const collapsible = screen.getByTestId("collapsible");
      expect(collapsible).toHaveAttribute("data-open", "false");
    });

    test("DependencyGraph receives h-[280px] className on mobile", () => {
      (useIsMobile as any).mockReturnValue(true);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: ["t1"] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const graph = screen.getByTestId("dependency-graph");
      expect(graph.className).toContain("h-[280px]");
    });

    test("DependencyGraph receives h-[380px] className on desktop", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: [] });
      const task2 = createMockTask({ id: "t2", dependsOnTaskIds: ["t1"] });
      const feature = createMockFeature([task1, task2]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const graph = screen.getByTestId("dependency-graph");
      expect(graph.className).toContain("h-[380px]");
    });
  });
});
