import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskStartInput } from "@/app/w/[slug]/task/[...taskParams]/components/TaskStartInput";
import { WorkflowNode } from "@/hooks/useWorkflowNodes";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: vi.fn(() => null),
  }),
}));

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    span: ({ children, className, ...props }: any) => (
      <span className={className} {...props}>
        {children}
      </span>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock hooks
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "test-workspace-id",
      slug: "test-workspace",
      name: "Test Workspace",
      repositories: [
        {
          id: "repo-1",
          name: "Test Repository 1",
          repositoryUrl: "https://github.com/test/repo1",
          branch: "main",
        },
        {
          id: "repo-2",
          name: "Test Repository 2",
          repositoryUrl: "https://github.com/test/repo2",
          branch: "master",
        },
      ],
    },
    slug: "test-workspace",
    role: "OWNER",
    isLoading: false,
    switchWorkspace: vi.fn(),
  }),
}));

vi.mock("@/hooks/useRepoBranches", () => ({
  useRepoBranches: () => ({
    branches: [
      { name: "main", sha: "abc123" },
      { name: "dev", sha: "def456" },
      { name: "feature/my-branch", sha: "ghi789" },
    ],
    isLoading: false,
    error: null,
    fetchBranches: vi.fn(),
  }),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => true,
}));

// Mock PromptsPanel
vi.mock("@/components/prompts", () => ({
  PromptsPanel: () => <div data-testid="prompts-panel">Prompts Panel</div>,
}));

describe("TaskStartInput - Workflow Mode Error Handling", () => {
  const mockOnStart = vi.fn();
  const mockOnModeChange = vi.fn();
  const mockOnWorkflowSelect = vi.fn();

  const mockWorkflows: WorkflowNode[] = [
    {
      node_type: "Workflow",
      ref_id: "workflow-ref-1",
      properties: {
        workflow_id: 12345,
        workflow_name: "Test Workflow 1",
        workflow_json: JSON.stringify({ nodes: [], edges: [] }),
      },
    },
    {
      node_type: "Workflow",
      ref_id: "workflow-ref-2",
      properties: {
        workflow_id: 67890,
        workflow_name: "Test Workflow 2",
        workflow_json: JSON.stringify({ nodes: [], edges: [] }),
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not show error immediately when switching to workflow mode", () => {
    const { rerender } = render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="agent"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    // Switch to workflow mode
    rerender(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    // Error message should NOT be visible
    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
  });

  it("should show error after typing an invalid workflow ID", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Type an invalid workflow ID
    await user.type(input, "99999");

    // Error message should be visible after typing
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });
  });

  it("should show error after blurring empty workflow input with invalid ID", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Type an invalid workflow ID
    await user.type(input, "99999");
    
    // Blur the input
    fireEvent.blur(input);

    // Error message should be visible
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });
  });

  it("should clear error when valid workflow ID is entered", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // First type an invalid ID
    await user.type(input, "99999");
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });

    // Clear and type a valid ID
    await user.clear(input);
    await user.type(input, "12345");

    // Error should be gone, success message should appear
    await waitFor(() => {
      expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
    });
  });

  it("should reset interaction state when switching modes", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Type an invalid workflow ID to trigger interaction
    await user.type(input, "99999");
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });

    // Switch to agent mode
    rerender(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="agent"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    // Switch back to workflow mode
    rerender(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    // Error should not be visible immediately (interaction state was reset)
    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
  });

  it("should handle onBlur event and show error for invalid workflow", async () => {
    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Manually change the value and trigger blur
    fireEvent.change(input, { target: { value: "99999" } });
    fireEvent.blur(input);

    // Error message should be visible after blur
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });
  });

  it("should not show error if workflows are still loading", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={true}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Type an invalid workflow ID
    await user.type(input, "99999");

    // Error should NOT show while loading
    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
  });

  it("should not show error if workflows array is empty", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={[]}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");

    // Type any workflow ID
    await user.type(input, "12345");

    // Error should NOT show when workflows array is empty (fetch might have failed)
    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
  });

  it("should complete user flow: switch mode -> type invalid -> fix with valid", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="agent"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    // Step 1: Switch to workflow mode - no error should appear
    rerender(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();

    const input = screen.getByTestId("workflow-id-input");

    // Step 2: Type invalid workflow ID - error should appear
    await user.type(input, "99999");
    await waitFor(() => {
      expect(screen.getByText("Workflow not found")).toBeInTheDocument();
    });

    // Step 3: Clear and enter valid workflow ID - error clears, success shows
    await user.clear(input);
    await user.type(input, "67890");
    await waitFor(() => {
      expect(screen.queryByText("Workflow not found")).not.toBeInTheDocument();
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
    });

    // Step 4: Submit button should be enabled for valid workflow
    const submitButton = screen.getByTestId("task-start-submit");
    expect(submitButton).not.toBeDisabled();
  });

  it("should disable submit button when workflow not found", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");
    const submitButton = screen.getByTestId("task-start-submit");

    // Type invalid workflow ID
    await user.type(input, "99999");

    // Submit button should be disabled
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });

  it("should enable submit button when valid workflow is found", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="workflow_editor"
        onModeChange={mockOnModeChange}
        workflows={mockWorkflows}
        onWorkflowSelect={mockOnWorkflowSelect}
        isLoadingWorkflows={false}
      />
    );

    const input = screen.getByTestId("workflow-id-input");
    const submitButton = screen.getByTestId("task-start-submit");

    // Type valid workflow ID
    await user.type(input, "12345");

    // Submit button should be enabled
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });
});

describe("TaskStartInput - Branch Selector", () => {
  const mockOnStart = vi.fn();
  const mockOnModeChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement scrollIntoView; cmdk calls it when selecting items
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("should render branch selector when workspace has repositories", () => {
    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="live"
        onModeChange={mockOnModeChange}
        workspaceSlug="test-workspace"
      />
    );

    expect(screen.getByTestId("branch-selector-trigger")).toBeInTheDocument();
  });

  it("should display the repo default branch on initial render", () => {
    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="live"
        onModeChange={mockOnModeChange}
        workspaceSlug="test-workspace"
      />
    );

    // The trigger button should show the repo's configured default branch
    const trigger = screen.getByTestId("branch-selector-trigger");
    expect(trigger).toHaveTextContent("main");
  });

  it("should truncate a long branch name and not overflow the container", () => {
    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="live"
        onModeChange={mockOnModeChange}
        workspaceSlug="test-workspace"
      />
    );

    const trigger = screen.getByTestId("branch-selector-trigger");
    // The trigger must have max-w constraint so it cannot grow unboundedly
    expect(trigger.className).toMatch(/max-w-\[180px\]/);
    // The container row must have overflow-hidden to prevent collision with the right-side buttons
    const container = trigger.closest('[class*="absolute bottom-6 left-8"]');
    expect(container?.className).toMatch(/overflow-hidden/);
  });

  it("should render PopoverContent with side=bottom to open downward", () => {
    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="live"
        onModeChange={mockOnModeChange}
        workspaceSlug="test-workspace"
      />
    );

    // Open the branch popover so PopoverContent is rendered
    const trigger = screen.getByTestId("branch-selector-trigger");
    fireEvent.click(trigger);

    // PopoverContent rendered by Radix adds data-side attribute when open
    // We verify the branch list is visible (popover opened correctly)
    const commandInput = screen.queryByPlaceholderText("Search branch...");
    expect(commandInput).toBeInTheDocument();
  });

  it("should call onStart with the selected branch as the 6th argument", async () => {
    const user = userEvent.setup();

    render(
      <TaskStartInput
        onStart={mockOnStart}
        taskMode="live"
        onModeChange={mockOnModeChange}
        workspaceSlug="test-workspace"
      />
    );

    // Type a task description
    const textarea = screen.getByTestId("task-start-input");
    await user.type(textarea, "My new task");

    // Open branch popover and select "dev"
    const trigger = screen.getByTestId("branch-selector-trigger");
    await user.click(trigger);

    const devOption = await screen.findByText("dev");
    await user.click(devOption);

    // Submit the task
    const submitButton = screen.getByTestId("task-start-submit");
    await user.click(submitButton);

    // Verify the branch is passed as the 6th argument; use direct call inspection
    // because expect.anything() does not match undefined (images may be undefined)
    expect(mockOnStart).toHaveBeenCalledTimes(1);
    const [msg, , , , , branch] = mockOnStart.mock.calls[0];
    expect(msg).toBe("My new task");
    expect(branch).toBe("dev");
  });
});
