import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useRecentWorkflows } from "@/hooks/useRecentWorkflows";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useWorkflowNodes");
vi.mock("@/hooks/useRecentWorkflows");

// Capture router.push via hoisted mock so tests can assert on it
const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/test-workspace/workflows",
  useSearchParams: () => new URLSearchParams(),
}));

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseWorkflowNodes = useWorkflowNodes as ReturnType<typeof vi.fn>;
const mockUseRecentWorkflows = useRecentWorkflows as ReturnType<typeof vi.fn>;

const mockRecentWorkflows = [
  { id: 1001, name: "Recent Workflow Alpha" },
  { id: 1002, name: "Recent Workflow Beta" },
  { id: 1003, name: "Recent Workflow Gamma" },
];

const mockWorkflows = [
  {
    ref_id: "ref1",
    properties: {
      workflow_id: 123,
      workflow_name: "Test Workflow 1",
      workflow_json: { steps: [] },
    },
  },
  {
    ref_id: "ref2",
    properties: {
      workflow_id: 456,
      workflow_name: "Test Workflow 2",
      workflow_json: { steps: [] },
    },
  },
  {
    ref_id: "ref3",
    properties: {
      workflow_id: 789,
      workflow_name: null,
      workflow_json: { steps: [] },
    },
  },
];

const mockVersions = [
  {
    workflow_version_id: "v1",
    workflow_id: 123,
    ref_id: "ref_v1",
    workflow_name: "Test Workflow 1",
    created_at: "2024-01-01T00:00:00Z",
    workflow_json: { steps: ["step1"] },
  },
  {
    workflow_version_id: "v2",
    workflow_id: 123,
    ref_id: "ref_v2",
    workflow_name: "Test Workflow 1",
    created_at: "2024-01-02T00:00:00Z",
    workflow_json: { steps: ["step2"] },
  },
];

const mockRunData = {
  id: 9999,
  name: "Test Run 9999",
  workflow_id: 123,
  created_at: new Date().toISOString(), // recent — isRecentRun = true
};

// Helper to set up fetch mock with no-run (404/fail) by default
function setupDefaultFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ success: false }),
  });
}

describe("WorkflowsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock pointer capture API for Radix UI Select
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }

    mockUseWorkspace.mockReturnValue({
      slug: "test-workspace",
      workspace: { id: "1", name: "Test Workspace" },
      role: "ADMIN",
    });
    mockUseWorkflowNodes.mockReturnValue({
      workflows: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRecentWorkflows.mockReturnValue({
      workflows: [],
      isLoading: false,
      error: null,
    });

    // Default: run check returns no run
    setupDefaultFetch();
  });

  describe("Rendering", () => {
    it("should render the page header", () => {
      render(<WorkflowsPage />);
      expect(screen.getByText("Workflows")).toBeInTheDocument();
      expect(screen.getByText("Manage and edit Stakwork workflows")).toBeInTheDocument();
    });

    it("should render workflow ID input field with updated placeholder", () => {
      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      expect(input).toBeInTheDocument();
    });

    it("should not render New Workflow button", () => {
      render(<WorkflowsPage />);
      expect(screen.queryByText("New Workflow")).not.toBeInTheDocument();
    });

    it("should not render workflow grid", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      // Workflows should not be displayed in grid
      expect(screen.queryByText("ID: 123")).not.toBeInTheDocument();
      expect(screen.queryByText("ID: 456")).not.toBeInTheDocument();
    });

    it("should not render loading spinner for workflow list", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("should not render error state for workflow list", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: "Failed to load workflows",
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      expect(screen.queryByText("Failed to load workflows")).not.toBeInTheDocument();
    });
  });

  describe("Workflow ID Validation", () => {
    it("should accept numeric workflow ID input", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");
      expect(input).toHaveValue("123");
    });

    it("should find matching workflow by ID", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      // Should display workflow name
      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });
    });

    it("should not show version selector for unknown workflow ID with no versions", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "999");

      await waitFor(() => {
        // Version selector must not render (it was removed in the refactor)
        expect(screen.queryByTestId("workflow-version-selector")).not.toBeInTheDocument();
        // Should not show a workflow name match
        expect(screen.queryByText("Workflow:")).not.toBeInTheDocument();
      });
    });

    it("should handle workflow without name (fallback)", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "789");

      await waitFor(() => {
        expect(screen.getByText("Workflow 789")).toBeInTheDocument();
      });
    });
  });

  describe("Version Selection", () => {
    it("should display Inspect Workflow button when workflow is matched", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Inspect Workflow button should be rendered (no version selector needed)
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
      });
    });

    it("shows Inspect Workflow button when workflow is matched", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
      });
    });

    it("should update workflow name when workflow ID changes", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");
      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Change workflow ID
      await user.clear(input);
      await user.type(input, "456");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
      });
    });
  });

  describe("Button Rendering Logic", () => {
    it("should not show any action buttons when no ID is entered", () => {
      render(<WorkflowsPage />);
      expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
      expect(screen.queryByText("Debug this run")).not.toBeInTheDocument();
    });

    it("should not show action buttons when workflow selected but no run", async () => {
      const user = userEvent.setup();
      // Workflow 123 exists in mockWorkflows — Inspect Workflow IS shown
      // This test verifies Debug this run is not shown when no run
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Inspect Workflow is present, but Debug this run is not
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
      });
    });

    it("should show only Inspect Workflow when workflow-only (no run)", async () => {
      const user = userEvent.setup();
      // Fetch returns no run
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false }),
      });

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
      });
    });

    it("should show only Debug this run when run-only (no matched workflow)", async () => {
      const user = userEvent.setup();
      // Fetch returns a run, but 9999 doesn't match any workflow in mockWorkflows
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project: mockRunData } }),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "9999");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /debug this run/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /inspect workflow/i })).not.toBeInTheDocument();
      });
    });

    it("should show both buttons when ID matches both a run and a workflow", async () => {
      const user = userEvent.setup();
      // Fetch always returns a run; ID 123 matches a workflow in mockWorkflows
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project: mockRunData } }),
      });

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /debug this run/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it("should show no buttons for an unknown ID (no run, no matched workflow)", async () => {
      const user = userEvent.setup();
      // Fetch returns no run, and 00000 doesn't match any workflow
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false }),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "00000");

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /inspect workflow/i })).not.toBeInTheDocument();
      });
    });

    it("should not show Debug this run button when run created_at is older than 1 year", async () => {
      const user = userEvent.setup();
      const staleDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
      const staleRunData = { ...mockRunData, created_at: staleDate };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project: staleRunData } }),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "9999");

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
      });
    });

    it("should not show disambiguation prompt when run is stale but workflow exists", async () => {
      const user = userEvent.setup();
      const staleDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
      const staleRunData = { ...mockRunData, created_at: staleDate };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project: staleRunData } }),
      });

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      await waitFor(() => {
        // Disambiguation prompt must not appear (stale run ≠ recent run)
        expect(
          screen.queryByText(/found both a Run and a Workflow/i)
        ).not.toBeInTheDocument();
        // Debug this run must not appear
        expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
      });
    });
  });

  describe("handleDebugRun", () => {
    it("should call fetch in correct order: versions → task → artifact → workflow-editor, then navigate", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();

      // Call 1: run check (from useEffect on debouncedWorkflowId)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project: mockRunData } }),
      });
      // Call 2: versions fetch (handleDebugRun step 1)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { versions: [mockVersions[0]] },
        }),
      });
      // Call 3: create task (handleDebugRun step 2)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "debug-task-1" } }),
      });
      // Call 4: save artifact (handleDebugRun step 3)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      // Call 5: dual-write WorkflowTask row (handleDebugRun step 3b)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      // Call 6: workflow-editor (handleDebugRun step 4)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      global.fetch = mockFetch;

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "9999");

      const debugButton = await screen.findByText("Debug this run");
      await user.click(debugButton);

      await waitFor(() => {
        expect(window.location.href).toBe("/w/test-workspace/task/debug-task-1");
      });

      // Verify fetch call order
      const fetchCalls = mockFetch.mock.calls;
      // call[0]: run check
      expect(fetchCalls[0][0]).toContain("/api/stakwork/projects/9999");
      // call[1]: versions
      expect(fetchCalls[1][0]).toContain(`/api/workspaces/test-workspace/workflows/${mockRunData.workflow_id}/versions`);
      // call[2]: create task
      expect(fetchCalls[2][0]).toBe("/api/tasks");
      expect(JSON.parse(fetchCalls[2][1].body)).toMatchObject({
        title: `Debug run ${mockRunData.id}`,
        mode: "workflow_editor",
        workspaceSlug: "test-workspace",
      });
      // call[3]: save artifact
      expect(fetchCalls[3][0]).toBe("/api/tasks/debug-task-1/messages/save");
      const artifactBody = JSON.parse(fetchCalls[3][1].body);
      expect(artifactBody.role).toBe("ASSISTANT");
      expect(artifactBody.artifacts[0].type).toBe("WORKFLOW");
      // call[4]: dual-write WorkflowTask row
      expect(fetchCalls[4][0]).toBe("/api/tasks/debug-task-1/workflow-task");
      // call[5]: workflow-editor
      expect(fetchCalls[5][0]).toBe("/api/workflow-editor");
      const editorBody = JSON.parse(fetchCalls[5][1].body);
      expect(editorBody.message).toBe(`Debug this run ${mockRunData.id}`);
      expect(editorBody.taskId).toBe("debug-task-1");
    }, 15000);

    it("should reset isDebugging on error and not navigate", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();

      // Run check succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project: mockRunData } }),
      });
      // Versions fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ data: { versions: [] } }),
      });

      global.fetch = mockFetch;

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "9999");

      const debugButton = await screen.findByText("Debug this run");
      await user.click(debugButton);

      // Should not navigate
      await waitFor(() => {
        expect(window.location.href).toBe("");
      });

      // Button should re-appear (isDebugging reset)
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /debug this run/i })).toBeInTheDocument();
      });
    }, 15000);
  });

  describe("Inspect Workflow button", () => {
    it("should not show Inspect Workflow button when no workflow matched", () => {
      render(<WorkflowsPage />);
      expect(screen.queryByRole("button", { name: /inspect workflow/i })).not.toBeInTheDocument();
    });

    it("should show Inspect Workflow button when a workflow is matched", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /inspect workflow/i })).toBeInTheDocument();
      });
    });

    it("should navigate to workflow inspector on click", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      const btn = await screen.findByRole("button", { name: /inspect workflow/i });
      await user.click(btn);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/workflows/123");
      });
    });
  });

  describe("Recent Workflows", () => {
    it("renders the Recent Workflows section heading", () => {
      render(<WorkflowsPage />);
      expect(screen.getByText("Recently Modified")).toBeInTheDocument();
    });

    it("renders skeleton rows when isLoading is true", () => {
      mockUseRecentWorkflows.mockReturnValue({
        workflows: [],
        isLoading: true,
        error: null,
      });

      render(<WorkflowsPage />);

      // 4 skeleton divs with animate-pulse class
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThanOrEqual(4);
      // Empty/error state should not show while loading
      expect(screen.queryByText("No recent workflows found")).not.toBeInTheDocument();
    });

    it("renders empty state when workflows array is empty", () => {
      mockUseRecentWorkflows.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      expect(screen.getByText("No recent workflows found")).toBeInTheDocument();
    });

    it("renders empty state when error is present", () => {
      mockUseRecentWorkflows.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: "Failed to fetch",
      });

      render(<WorkflowsPage />);
      expect(screen.getByText("No recent workflows found")).toBeInTheDocument();
    });

    it("renders workflow names and IDs when populated", () => {
      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      expect(screen.getByText("Recent Workflow Alpha")).toBeInTheDocument();
      expect(screen.getByText("Recent Workflow Beta")).toBeInTheDocument();
      expect(screen.getByText("Recent Workflow Gamma")).toBeInTheDocument();
      expect(screen.getByText("#1001")).toBeInTheDocument();
      expect(screen.getByText("#1002")).toBeInTheDocument();
      expect(screen.getByText("#1003")).toBeInTheDocument();
    });

    it("clicking a recent workflow row navigates to the workflow inspector", async () => {
      const user = userEvent.setup();

      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      const row = screen.getByText("Recent Workflow Alpha").closest("button")!;
      await user.click(row);

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/workflows/1001");
    });

    it("clicking a different row navigates to that workflow's inspector", async () => {
      const user = userEvent.setup();

      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      await user.click(screen.getByText("Recent Workflow Beta").closest("button")!);
      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/workflows/1002");

      await user.click(screen.getByText("Recent Workflow Gamma").closest("button")!);
      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/workflows/1003");
    });

    it("does not render skeleton or empty state when populated", () => {
      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      expect(screen.queryByText("No recent workflows found")).not.toBeInTheDocument();
    });
  });
});


