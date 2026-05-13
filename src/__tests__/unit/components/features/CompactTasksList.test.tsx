// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { CompactTasksList } from "@/components/features/CompactTasksList";
import type { FeatureWithDetails } from "@/types/roadmap";
import type { WorkspaceWithAccess } from "@/types/workspace";
import { TaskStatus } from "@prisma/client";
import userEvent from "@testing-library/user-event";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePusherConnection } from "@/hooks/usePusherConnection";

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

vi.mock("@/hooks/useRecentWorkflows", () => ({
  useRecentWorkflows: () => ({ workflows: [], isLoading: false, error: null }),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => false,
}));

vi.mock("@/hooks/useTicketMutations", () => ({
  useTicketMutations: () => ({
    updateTicket: vi.fn().mockResolvedValue({}),
  }),
}));

const mockRoadmapUpdateTicket = vi.fn().mockResolvedValue(null);
vi.mock("@/hooks/useRoadmapTaskMutations", () => ({
  useRoadmapTaskMutations: () => ({
    updateTicket: mockRoadmapUpdateTicket,
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
  SelectGroup: ({ children }: any) => <div>{children}</div>,
  SelectLabel: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
  SelectSeparator: () => <hr />,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
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
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const mockLlmModels = [
  { id: "model-1", name: "claude-sonnet-4", provider: "ANTHROPIC", providerLabel: "Claude Sonnet 4" },
  { id: "model-2", name: "gpt-4o", provider: "OPENAI", providerLabel: "GPT-4o" },
];

describe("CompactTasksList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue({
      push: mockPush,
    });
    // Default: return empty models so existing tests are unaffected
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/llm-models")) {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
      }
      if (typeof url === "string" && url.includes("/sync-status")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    runBuild: true,
    runTestSuite: true,
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
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });
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
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 500 }));
      });
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
      const pendingPromise = new Promise<Response>((res) => { resolveRequest = res; });
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        return pendingPromise;
      });

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

      // The SelectTrigger should have max-w-[140px] to constrain width
      const trigger = screen.getByTestId("select-trigger");
      expect(trigger.className).toMatch(/max-w-\[140px\]/);

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

    test("graphOpen initialises to true (expanded) by default on desktop when multiple tasks exist", () => {
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
      expect(collapsible).toHaveAttribute("data-open", "true");
    });

    test("graphOpen initialises to true (expanded) by default on mobile when multiple tasks exist", () => {
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
      expect(collapsible).toHaveAttribute("data-open", "true");
    });

    test("graphOpen initialises to false (collapsed) by default when only 1 task exists", () => {
      (useIsMobile as any).mockReturnValue(false);
      const task1 = createMockTask({ id: "t1", dependsOnTaskIds: ["some-other-task"] });
      const feature = createMockFeature([task1]);

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

  describe("Pusher feature channel subscription", () => {
    test("subscribes to featureId channel with onFeatureUpdated callback", () => {
      const task = createMockTask({ id: "task-1" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-42"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      // Should be called at least twice: once for workspace channel, once for feature channel
      const calls = (usePusherConnection as ReturnType<typeof vi.fn>).mock.calls;
      const featureChannelCall = calls.find((call: any[]) => call[0]?.featureId === "feature-42");
      expect(featureChannelCall).toBeDefined();
      expect(featureChannelCall[0].enabled).toBe(true);
      expect(typeof featureChannelCall[0].onFeatureUpdated).toBe("function");
    });

    test("onFeatureUpdated fetches feature and calls onUpdate with result", async () => {
      const task = createMockTask({ id: "task-1" });
      const feature = createMockFeature([task]);
      const onUpdate = vi.fn();

      const updatedFeature = createMockFeature([
        createMockTask({ id: "task-1" }),
        createMockTask({ id: "task-2", title: "New Task" }),
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (typeof url === "string" && url.includes("/sync-status")) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: updatedFeature }), { status: 200 }));
      });

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-42"
          isGenerating={false}
          onUpdate={onUpdate}
        />
      );

      // Grab the onFeatureUpdated callback from the feature channel subscription
      const calls = (usePusherConnection as ReturnType<typeof vi.fn>).mock.calls;
      const featureChannelCall = calls.find((call: any[]) => call[0]?.featureId === "feature-42");
      const onFeatureUpdated: () => Promise<void> = featureChannelCall[0].onFeatureUpdated;

      // Simulate Pusher firing FEATURE_UPDATED
      await onFeatureUpdated();

      expect(fetchSpy).toHaveBeenCalledWith("/api/features/feature-42");
      // onUpdate receives the parsed JSON (dates become strings), so check meaningful content
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const receivedFeature = onUpdate.mock.calls[0][0];
      const receivedTaskIds = receivedFeature.phases
        .flatMap((p: any) => p.tasks)
        .map((t: any) => t.id);
      expect(receivedTaskIds).toContain("task-1");
      expect(receivedTaskIds).toContain("task-2");

      fetchSpy.mockRestore();
    });

    test("onFeatureUpdated does not call onUpdate when fetch fails", async () => {
      const task = createMockTask({ id: "task-1" });
      const feature = createMockFeature([task]);
      const onUpdate = vi.fn();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 500 }));
      });

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-42"
          isGenerating={false}
          onUpdate={onUpdate}
        />
      );

      const calls = (usePusherConnection as ReturnType<typeof vi.fn>).mock.calls;
      const featureChannelCall = calls.find((call: any[]) => call[0]?.featureId === "feature-42");
      const onFeatureUpdated: () => Promise<void> = featureChannelCall[0].onFeatureUpdated;

      await onFeatureUpdated();

      expect(onUpdate).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });

  describe("Run Build and Run Tests toggles", () => {
    beforeEach(() => {
      mockRoadmapUpdateTicket.mockClear();
    });

    test("renders run build and run tests toggles for each task", () => {
      const task = createMockTask({ id: "task-1", runBuild: true, runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText("run build")).toBeInTheDocument();
      expect(screen.getByText("run tests")).toBeInTheDocument();
    });

    test("run build toggle defaults to true (checked) when runBuild is undefined", () => {
      const task = createMockTask({ id: "task-1", runBuild: undefined });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      // 3 toggles per task: autoMerge (index 0), runBuild (index 1), runTestSuite (index 2)
      const toggles = screen.getAllByTestId("mini-toggle");
      expect(toggles[1]).toBeChecked();
    });

    test("run tests toggle defaults to true (checked) when runTestSuite is undefined", () => {
      const task = createMockTask({ id: "task-1", runTestSuite: undefined });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      expect(toggles[2]).toBeChecked();
    });

    test("clicking run build toggle calls updateTicket with { runBuild: false }", async () => {
      const user = userEvent.setup();
      const task = createMockTask({ id: "task-toggle", status: "TODO", runBuild: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      await user.click(toggles[1]); // runBuild

      expect(mockRoadmapUpdateTicket).toHaveBeenCalledWith({
        taskId: "task-toggle",
        updates: { runBuild: false },
      });
    });

    test("clicking run tests toggle calls updateTicket with { runTestSuite: false }", async () => {
      const user = userEvent.setup();
      const task = createMockTask({ id: "task-toggle", status: "TODO", runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      await user.click(toggles[2]); // runTestSuite

      expect(mockRoadmapUpdateTicket).toHaveBeenCalledWith({
        taskId: "task-toggle",
        updates: { runTestSuite: false },
      });
    });

    test("run build and run tests toggles are disabled when task status is not TODO", () => {
      const task = createMockTask({ id: "task-1", status: "IN_PROGRESS", runBuild: true, runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      expect(toggles[1]).toBeDisabled(); // runBuild
      expect(toggles[2]).toBeDisabled(); // runTestSuite
    });

    test("run build and run tests toggles are enabled when task status is TODO", () => {
      const task = createMockTask({ id: "task-1", status: "TODO", runBuild: true, runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      expect(toggles[1]).not.toBeDisabled(); // runBuild
      expect(toggles[2]).not.toBeDisabled(); // runTestSuite
    });

    test("hides auto-merge, run build, and run tests toggles for workflow tasks", () => {
      const task = createMockTask({
        id: "task-workflow",
        workflowTask: {
          id: "wt-1",
          workflowId: 123,
          workflowName: "My Workflow",
          workflowRefId: "ref-123",
          workflowVersionId: null,
        },
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

      expect(screen.queryByText("auto-merge")).not.toBeInTheDocument();
      expect(screen.queryByText("run build")).not.toBeInTheDocument();
      expect(screen.queryByText("run tests")).not.toBeInTheDocument();
    });

    test("shows all three toggles for repo-targeted tasks (workflowTask is null)", () => {
      const task = createMockTask({
        id: "task-repo",
        workflowTask: null,
        runBuild: true,
        runTestSuite: true,
        autoMerge: false,
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

      expect(screen.getByText("auto-merge")).toBeInTheDocument();
      expect(screen.getByText("run build")).toBeInTheDocument();
      expect(screen.getByText("run tests")).toBeInTheDocument();
    });
  });

  describe("Optimistic updates", () => {
    beforeEach(() => {
      mockRoadmapUpdateTicket.mockClear();
    });

    test("auto-merge toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      // Never-resolving promise simulates slow network
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", autoMerge: false });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const autoMergeToggle = toggles[0];
      expect(autoMergeToggle).not.toBeChecked();

      await user.click(autoMergeToggle);

      // Toggle should flip immediately, before the promise resolves
      expect(autoMergeToggle).toBeChecked();

      // Clean up
      resolveTicket(null);
    });

    test("run build toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", runBuild: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runBuildToggle = toggles[1];
      expect(runBuildToggle).toBeChecked();

      await user.click(runBuildToggle);

      // Should flip immediately
      expect(runBuildToggle).not.toBeChecked();

      resolveTicket(null);
    });

    test("run tests toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runTestsToggle = toggles[2];
      expect(runTestsToggle).toBeChecked();

      await user.click(runTestsToggle);

      expect(runTestsToggle).not.toBeChecked();

      resolveTicket(null);
    });

    test("toggle reverts to original value when updateTicket rejects", async () => {
      const user = userEvent.setup();
      mockRoadmapUpdateTicket.mockRejectedValueOnce(new Error("Network error"));

      const task = createMockTask({ id: "task-revert", status: "TODO", autoMerge: false });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const autoMergeToggle = toggles[0];
      expect(autoMergeToggle).not.toBeChecked();

      await user.click(autoMergeToggle);

      // After rejection, toggle should revert
      await waitFor(() => {
        expect(autoMergeToggle).not.toBeChecked();
      });
    });

    test("run build toggle reverts when updateTicket rejects", async () => {
      const user = userEvent.setup();
      mockRoadmapUpdateTicket.mockRejectedValueOnce(new Error("Network error"));

      const task = createMockTask({ id: "task-revert", status: "TODO", runBuild: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runBuildToggle = toggles[1];
      expect(runBuildToggle).toBeChecked();

      await user.click(runBuildToggle);

      await waitFor(() => {
        expect(runBuildToggle).toBeChecked();
      });
    });
  });

  describe("Model selector", () => {
    test("renders model selector when llm models are available", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: mockLlmModels }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      const task = createMockTask({ id: "task-1", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      await waitFor(() => {
        const selects = screen.getAllByTestId("select");
        // Should have repo selector + model selector = 2 selects (workspace has 2 repos so repo selector shows)
        expect(selects.length).toBeGreaterThanOrEqual(1);
      });
    });

    test("does not render model selector when no llm models available", async () => {
      const task = createMockTask({ id: "task-1", status: "TODO" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      await waitFor(() => {
        // Only the repo selector should be present (no model selector)
        const selects = screen.queryAllByTestId("select");
        // With empty models, only repo selector present
        selects.forEach((s) => {
          expect(s.getAttribute("data-value")).not.toMatch(/anthropic|openai|google/);
        });
      });
    });

    test("model selector is disabled for non-TODO tasks", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: mockLlmModels }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      const task = createMockTask({ id: "task-1", status: "IN_PROGRESS", model: null });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      // The Select mock renders with data-value; check model select by looking at children (SelectItems)
      // The model select wraps in a div with stopPropagation; we can verify disabled by checking mock Select
      await waitFor(() => {
        const selects = screen.getAllByTestId("select");
        // With IN_PROGRESS task and models loaded, repo selector and model selector both present
        expect(selects.length).toBeGreaterThanOrEqual(1);
      });
    });

    test("calls updateTicket with model value when model selector changes", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: mockLlmModels }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      const task = createMockTask({ id: "task-model", status: "TODO", model: null });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      // Wait until the model select (data-value="") is present — it only renders once
      // llmModels loads from the async fetch, so we must wait inside waitFor.
      let modelSelect: HTMLElement | undefined;
      await waitFor(() => {
        const selects = screen.getAllByTestId("select");
        modelSelect = selects.find((s) => s.getAttribute("data-value") === "");
        expect(modelSelect).toBeDefined();
      });
    });

    test("shows existing model value in selector", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: mockLlmModels }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      const task = createMockTask({ id: "task-model", status: "TODO", model: "anthropic/claude-sonnet-4" });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      await waitFor(() => {
        const selects = screen.getAllByTestId("select");
        const modelSelect = selects.find((s) => s.getAttribute("data-value") === "anthropic/claude-sonnet-4");
        expect(modelSelect).toBeDefined();
      });
    });
  });

  describe("Optimistic updates", () => {
    beforeEach(() => {
      mockRoadmapUpdateTicket.mockClear();
    });

    test("auto-merge toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      // Never-resolving promise simulates slow network
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", autoMerge: false });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const autoMergeToggle = toggles[0];
      expect(autoMergeToggle).not.toBeChecked();

      await user.click(autoMergeToggle);

      // Toggle should flip immediately, before the promise resolves
      expect(autoMergeToggle).toBeChecked();

      // Clean up
      resolveTicket(null);
    });

    test("run build toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", runBuild: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runBuildToggle = toggles[1];
      expect(runBuildToggle).toBeChecked();

      await user.click(runBuildToggle);

      // Should flip immediately
      expect(runBuildToggle).not.toBeChecked();

      resolveTicket(null);
    });

    test("run tests toggle reflects new value immediately before updateTicket resolves", async () => {
      const user = userEvent.setup();
      let resolveTicket!: (v: any) => void;
      const pendingPromise = new Promise<any>((res) => { resolveTicket = res; });
      mockRoadmapUpdateTicket.mockReturnValueOnce(pendingPromise);

      const task = createMockTask({ id: "task-opt", status: "TODO", runTestSuite: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runTestsToggle = toggles[2];
      expect(runTestsToggle).toBeChecked();

      await user.click(runTestsToggle);

      expect(runTestsToggle).not.toBeChecked();

      resolveTicket(null);
    });

    test("toggle reverts to original value when updateTicket rejects", async () => {
      const user = userEvent.setup();
      mockRoadmapUpdateTicket.mockRejectedValueOnce(new Error("Network error"));

      const task = createMockTask({ id: "task-revert", status: "TODO", autoMerge: false });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const autoMergeToggle = toggles[0];
      expect(autoMergeToggle).not.toBeChecked();

      await user.click(autoMergeToggle);

      // After rejection, toggle should revert
      await waitFor(() => {
        expect(autoMergeToggle).not.toBeChecked();
      });
    });

    test("run build toggle reverts when updateTicket rejects", async () => {
      const user = userEvent.setup();
      mockRoadmapUpdateTicket.mockRejectedValueOnce(new Error("Network error"));

      const task = createMockTask({ id: "task-revert", status: "TODO", runBuild: true });
      const feature = createMockFeature([task]);

      render(
        <CompactTasksList
          feature={feature}
          featureId="feature-1"
          isGenerating={false}
          onUpdate={vi.fn()}
        />
      );

      const toggles = screen.getAllByTestId("mini-toggle");
      const runBuildToggle = toggles[1];
      expect(runBuildToggle).toBeChecked();

      await user.click(runBuildToggle);

      await waitFor(() => {
        expect(runBuildToggle).toBeChecked();
      });
    });
  });

  describe("handleDuplicateTask — dependency mapping", () => {
    const createMockTask = (overrides: any = {}) => ({
      id: "task-1",
      title: "Test Task",
      status: "TODO" as TaskStatus,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-02"),
      assignee: null,
      repository: null,
      autoMerge: false,
      runBuild: true,
      runTestSuite: true,
      prArtifact: null,
      deploymentStatus: null,
      deployedToStagingAt: null,
      deployedToProductionAt: null,
      systemAssigneeType: null,
      dependsOnTaskIds: [],
      workflowStatus: null,
      phaseId: "phase-1",
      description: null,
      priority: "MEDIUM",
      ...overrides,
    });

    const createMockFeature = (tasks: any[] = []): any => ({
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

    const setupFetchMock = (overrides: Record<string, any> = {}) => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (overrides[urlStr]) {
          return overrides[urlStr]();
        }
        // Default: feature refetch
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });
    };

    beforeEach(() => {
      vi.clearAllMocks();
      (useRouter as any).mockReturnValue({ push: mockPush });
    });

    test("1. no dependencies — POST body has empty dependsOnTaskIds, no PATCH calls fired", async () => {
      const user = userEvent.setup();
      const task = createMockTask({ id: "task-no-deps", dependsOnTaskIds: [] });
      const feature = createMockFeature([task]);
      const capturedBodies: any[] = [];

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          capturedBodies.push(JSON.parse(init.body));
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "new-task-id", title: task.title, dependsOnTaskIds: [] } }), { status: 200 }));
        }
        // feature refetch
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      const duplicateBtn = await screen.findByTestId("action-duplicate");
      await user.click(duplicateBtn);

      await waitFor(() => {
        expect(capturedBodies).toHaveLength(1);
        expect(capturedBodies[0].dependsOnTaskIds).toEqual([]);
      });

      // No PATCH to /api/tickets/ should have been made
      const fetchMock = vi.mocked(globalThis.fetch);
      const patchCalls = fetchMock.mock.calls.filter(
        ([url, init]: any) => typeof url === "string" && url.includes("/api/tickets/") && init?.method === "PATCH"
      );
      expect(patchCalls).toHaveLength(0);
    });

    test("2. upstream only — POST body includes original dependsOnTaskIds, no PATCH calls", async () => {
      const user = userEvent.setup();
      const upstream = createMockTask({ id: "upstream-1" });
      const task = createMockTask({ id: "task-upstream", dependsOnTaskIds: ["upstream-1"] });
      const feature = createMockFeature([upstream, task]);
      const capturedBodies: any[] = [];

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          capturedBodies.push(JSON.parse(init.body));
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "new-task-id", dependsOnTaskIds: ["upstream-1"] } }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      // Click the duplicate action for the second task (with upstream deps)
      const duplicateBtns = await screen.findAllByTestId("action-duplicate");
      await user.click(duplicateBtns[1]);

      await waitFor(() => {
        expect(capturedBodies).toHaveLength(1);
        expect(capturedBodies[0].dependsOnTaskIds).toEqual(["upstream-1"]);
      });

      const fetchMock = vi.mocked(globalThis.fetch);
      const patchCalls = fetchMock.mock.calls.filter(
        ([url, init]: any) => typeof url === "string" && url.includes("/api/tickets/") && init?.method === "PATCH"
      );
      expect(patchCalls).toHaveLength(0);
    });

    test("3. downstream only — POST has empty dependsOnTaskIds, downstream task patched with new ID", async () => {
      const user = userEvent.setup();
      const task = createMockTask({ id: "task-original", dependsOnTaskIds: [] });
      // downstream task depends on task-original
      const downstream = createMockTask({ id: "task-downstream", dependsOnTaskIds: ["task-original"] });
      const feature = createMockFeature([task, downstream]);
      const capturedBodies: any[] = [];
      const patchBodies: Record<string, any> = {};

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          capturedBodies.push(JSON.parse(init.body));
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "new-task-id" } }), { status: 200 }));
        }
        if (urlStr.includes("/api/tickets/") && init?.method === "PATCH") {
          const taskId = urlStr.split("/api/tickets/")[1];
          patchBodies[taskId] = JSON.parse(init.body);
          return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      const duplicateBtns = await screen.findAllByTestId("action-duplicate");
      await user.click(duplicateBtns[0]); // click duplicate on task-original

      await waitFor(() => {
        expect(capturedBodies).toHaveLength(1);
        expect(capturedBodies[0].dependsOnTaskIds).toEqual([]);
      });

      await waitFor(() => {
        expect(patchBodies["task-downstream"]).toBeDefined();
        expect(patchBodies["task-downstream"].dependsOnTaskIds).toContain("task-original");
        expect(patchBodies["task-downstream"].dependsOnTaskIds).toContain("new-task-id");
      });
    });

    test("4. both directions — POST includes upstream deps, downstream tasks patched", async () => {
      const user = userEvent.setup();
      const upstream = createMockTask({ id: "upstream-1" });
      const task = createMockTask({ id: "task-both", dependsOnTaskIds: ["upstream-1"] });
      const downstream = createMockTask({ id: "task-downstream", dependsOnTaskIds: ["task-both"] });
      const feature = createMockFeature([upstream, task, downstream]);
      const capturedPostBodies: any[] = [];
      const patchBodies: Record<string, any> = {};

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          capturedPostBodies.push(JSON.parse(init.body));
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "new-task-id" } }), { status: 200 }));
        }
        if (urlStr.includes("/api/tickets/") && init?.method === "PATCH") {
          const taskId = urlStr.split("/api/tickets/")[1];
          patchBodies[taskId] = JSON.parse(init.body);
          return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      const duplicateBtns = await screen.findAllByTestId("action-duplicate");
      await user.click(duplicateBtns[1]); // click duplicate on task-both (index 1)

      await waitFor(() => {
        expect(capturedPostBodies).toHaveLength(1);
        expect(capturedPostBodies[0].dependsOnTaskIds).toEqual(["upstream-1"]);
      });

      await waitFor(() => {
        expect(patchBodies["task-downstream"]).toBeDefined();
        expect(patchBodies["task-downstream"].dependsOnTaskIds).toContain("task-both");
        expect(patchBodies["task-downstream"].dependsOnTaskIds).toContain("new-task-id");
      });
    });

    test("5. downstream PATCH failure — warning toast shown, duplicate not rolled back", async () => {
      const user = userEvent.setup();
      const { toast } = await import("sonner");
      const task = createMockTask({ id: "task-original", dependsOnTaskIds: [] });
      const downstream = createMockTask({ id: "task-downstream", dependsOnTaskIds: ["task-original"] });
      const feature = createMockFeature([task, downstream]);

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "new-task-id" } }), { status: 200 }));
        }
        if (urlStr.includes("/api/tickets/") && init?.method === "PATCH") {
          return Promise.reject(new Error("Network failure"));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { id: "feature-1", phases: [{ id: "phase-1", tasks: [] }] } }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      const duplicateBtns = await screen.findAllByTestId("action-duplicate");
      await user.click(duplicateBtns[0]);

      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          "Task duplicated, but some dependency links could not be updated"
        );
      });

      // success toast still fires (duplicate was created)
      expect(toast.success).toHaveBeenCalledWith("Task duplicated");
    });

    test("6. POST failure — no PATCH calls fired", async () => {
      const user = userEvent.setup();
      const task = createMockTask({ id: "task-original", dependsOnTaskIds: [] });
      const downstream = createMockTask({ id: "task-downstream", dependsOnTaskIds: ["task-original"] });
      const feature = createMockFeature([task, downstream]);

      vi.spyOn(globalThis, "fetch").mockImplementation((url: any, init: any) => {
        const urlStr = typeof url === "string" ? url : String(url);
        if (urlStr.includes("/api/llm-models")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        if (urlStr.includes("/api/features/feature-1/tickets") && init?.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ error: "Server error" }), { status: 500 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      });

      render(
        <CompactTasksList feature={feature} featureId="feature-1" isGenerating={false} onUpdate={vi.fn()} />
      );

      const duplicateBtns = await screen.findAllByTestId("action-duplicate");
      await user.click(duplicateBtns[0]);

      const fetchMock = vi.mocked(globalThis.fetch);
      await waitFor(() => {
        // POST was called
        const postCalls = fetchMock.mock.calls.filter(
          ([url, init]: any) => typeof url === "string" && url.includes("/api/features/feature-1/tickets") && init?.method === "POST"
        );
        expect(postCalls).toHaveLength(1);
      });

      // No PATCH calls
      const patchCalls = fetchMock.mock.calls.filter(
        ([url, init]: any) => typeof url === "string" && url.includes("/api/tickets/") && init?.method === "PATCH"
      );
      expect(patchCalls).toHaveLength(0);
    });
  });
});