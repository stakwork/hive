import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";
import { useRecentWorkflows } from "@/hooks/useRecentWorkflows";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useWorkflowNodes");
vi.mock("@/hooks/useWorkflowVersions");
vi.mock("@/hooks/useRecentWorkflows");

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/test-workspace/workflows",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock WorkflowVersionSelector to simplify testing
vi.mock("@/components/workflow/WorkflowVersionSelector", () => ({
  WorkflowVersionSelector: ({ versions, selectedVersionId, onVersionSelect }: any) => {
    return (
      <div data-testid="workflow-version-selector">
        <select
          data-testid="version-select"
          value={selectedVersionId || ""}
          onChange={(e) => onVersionSelect(e.target.value)}
        >
          <option value="">Select Version</option>
          {versions?.map((v: any) => (
            <option key={v.workflow_version_id} value={v.workflow_version_id}>
              {v.workflow_version_id}
            </option>
          ))}
        </select>
      </div>
    );
  },
}));

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseWorkflowNodes = useWorkflowNodes as ReturnType<typeof vi.fn>;
const mockUseWorkflowVersions = useWorkflowVersions as ReturnType<typeof vi.fn>;
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
    ref_id: "ref_v1",
    workflow_name: "Test Workflow 1",
    created_at: "2024-01-01T00:00:00Z",
    workflow_json: { steps: ["step1"] },
  },
  {
    workflow_version_id: "v2",
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
    mockUseWorkflowVersions.mockReturnValue({
      versions: [],
      isLoading: false,
      error: null,
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
      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "999");

      await waitFor(() => {
        // Version selector must not render when there are no versions and nothing is loading
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
    it("should display version dropdown when workflow is matched", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Version selector should be rendered
      expect(screen.getByText("Select Version")).toBeInTheDocument();
    });

    it("should auto-select first version", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        // WorkflowVersionSelector auto-selects first version
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });
    });

    it("should reset version when workflow changes", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
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

    it("should not show action buttons when workflow selected but no version and no run", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
      expect(screen.queryByText("Debug this run")).not.toBeInTheDocument();
    });

    it("should show only Load Workflow when workflow-only (version selected, no run)", async () => {
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
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      const versionSelect = await screen.findByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      await waitFor(() => {
        expect(screen.queryByText("Load Workflow")).toBeInTheDocument();
        expect(screen.queryByText("Debug this run")).not.toBeInTheDocument();
      });
    });

    it("should show only Debug this run when run-only (no versions)", async () => {
      const user = userEvent.setup();
      // Fetch returns a run
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project: mockRunData } }),
      });

      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "9999");

      await waitFor(() => {
        expect(screen.queryByText("Debug this run")).toBeInTheDocument();
        expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
      });
    });

    it("should show both buttons when ID matches both a run and a workflow with version selected", async () => {
      const user = userEvent.setup();
      // Fetch always returns a run
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
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "123");

      // Wait for the debounce + run check to complete: "Debug this run" appears once
      // isResolvingRun resolves and runData is set. Only then select the version so
      // the version reset (triggered by debouncedWorkflowId change) has already happened.
      await waitFor(() => {
        expect(screen.queryByText("Debug this run")).toBeInTheDocument();
      }, { timeout: 2000 });

      // Now select a version — debouncedWorkflowId is stable so no more resets
      const versionSelect = screen.getByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      await waitFor(() => {
        expect(screen.queryByText("Debug this run")).toBeInTheDocument();
        expect(screen.queryByText("Load Workflow")).toBeInTheDocument();
      });
    });

    it("should show no buttons for an unknown ID (no run, no workflow versions)", async () => {
      const user = userEvent.setup();
      // Fetch returns no run
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false }),
      });

      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      await user.type(input, "00000");

      await waitFor(() => {
        expect(screen.queryByText("Debug this run")).not.toBeInTheDocument();
        expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
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
      // Call 5: workflow-editor (handleDebugRun step 4)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      global.fetch = mockFetch;

      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

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
      // call[4]: workflow-editor
      expect(fetchCalls[4][0]).toBe("/api/workflow-editor");
      const editorBody = JSON.parse(fetchCalls[4][1].body);
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

      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

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
        expect(screen.queryByText("Debug this run")).toBeInTheDocument();
      });
    }, 15000);
  });

  describe("Submit Button (Load Workflow)", () => {
    it("should not show submit button when no workflow selected", () => {
      render(<WorkflowsPage />);
      expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
    });

    it("should not show submit button when workflow selected but no version", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: [],
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      expect(screen.queryByText("Load Workflow")).not.toBeInTheDocument();
    });

    it("should show enabled submit button when workflow and version selected", async () => {
      const user = userEvent.setup();

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Wait for version selector to appear and select version
      const versionSelect = await screen.findByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      // Submit button should appear after version is selected
      await waitFor(() => {
        const submitButton = screen.queryByText("Load Workflow");
        expect(submitButton).toBeInTheDocument();
      });
    });
  });

  describe("Navigation (Load Workflow)", () => {
    it("should navigate to task chat on submit", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();

      // The debounce (300ms) fires after the submit click in this test environment,
      // so the run-check fetch is NOT called before handleSubmit runs.
      // Only the two submit calls need to be mocked.
      // Create task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "task-123" } }),
      });
      // Save artifact
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      global.fetch = mockFetch;

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      // Mock window.location.href
      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");

      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Wait for version selector to appear and select version
      const versionSelect = await screen.findByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      // Wait for submit button to appear
      const submitButton = await screen.findByText("Load Workflow");
      await user.click(submitButton);

      await waitFor(() => {
        expect(window.location.href).toBe("/w/test-workspace/task/task-123");
      });
    }, 10000);

    it("should create task with correct data", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();

      // The debounce fires after the submit click, so run-check is not called before handleSubmit.
      // Create task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "task-123" } }),
      });
      // Save artifact
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      global.fetch = mockFetch;

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");
      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Wait for version selector to appear and select version
      const versionSelect = await screen.findByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      // Wait for submit button to appear
      const submitButton = await screen.findByText("Load Workflow");
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/tasks",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("Test Workflow 1"),
          })
        );
      });
    }, 10000);

    it("should create workflow artifact with proper structure", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();

      // The debounce fires after the submit click, so run-check is not called before handleSubmit.
      // Create task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "task-123" } }),
      });
      // Save artifact
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      global.fetch = mockFetch;

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      mockUseWorkflowVersions.mockReturnValue({
        versions: mockVersions,
        isLoading: false,
        error: null,
      });

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.type(input, "123");
      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });

      // Wait for version selector to appear and select version
      const versionSelect = await screen.findByTestId("version-select");
      await user.selectOptions(versionSelect, "v1");

      // Wait for submit button to appear
      const submitButton = await screen.findByText("Load Workflow");
      await user.click(submitButton);

      await waitFor(() => {
        const artifactCall = mockFetch.mock.calls.find(
          call => call[0] === "/api/tasks/task-123/messages/save"
        );
        expect(artifactCall).toBeDefined();

        const body = JSON.parse(artifactCall![1].body);
        expect(body.artifacts).toHaveLength(1);
        expect(body.artifacts[0].type).toBe("WORKFLOW");
        expect(body.artifacts[0].content).toEqual(
          expect.objectContaining({
            workflowId: 123,
            workflowName: "Test Workflow 1",
            workflowVersionId: "v1",
            workflowRefId: "ref_v1",
          })
        );
      });
    }, 10000);
  });

  describe("Recent Workflows", () => {
    it("renders the Recent Workflows section heading", () => {
      render(<WorkflowsPage />);
      expect(screen.getByText("Recent Workflows")).toBeInTheDocument();
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

    it("clicking a recent workflow row sets the workflow ID input value", async () => {
      const user = userEvent.setup();

      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      expect(input).toHaveValue("");

      const row = screen.getByText("Recent Workflow Alpha").closest("button")!;
      await user.click(row);

      expect(input).toHaveValue("1001");
    });

    it("clicking a different row updates the input to that workflow's ID", async () => {
      const user = userEvent.setup();

      mockUseRecentWorkflows.mockReturnValue({
        workflows: mockRecentWorkflows,
        isLoading: false,
        error: null,
      });

      render(<WorkflowsPage />);

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");

      await user.click(screen.getByText("Recent Workflow Beta").closest("button")!);
      expect(input).toHaveValue("1002");

      await user.click(screen.getByText("Recent Workflow Gamma").closest("button")!);
      expect(input).toHaveValue("1003");
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


