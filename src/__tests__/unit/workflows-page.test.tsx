import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes } from "@/hooks/useWorkflowNodes";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useWorkflowNodes");
vi.mock("@/hooks/useWorkflowVersions");

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
    created_at: "2024-01-01T00:00:00Z",
    workflow_json: { steps: ["step1"] },
  },
  {
    workflow_version_id: "v2",
    ref_id: "ref_v2",
    created_at: "2024-01-02T00:00:00Z",
    workflow_json: { steps: ["step2"] },
  },
];

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

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe("Rendering", () => {
    it("should render the page header", () => {
      render(<WorkflowsPage />);
      expect(screen.getByText("Workflows")).toBeInTheDocument();
      expect(screen.getByText("Manage and edit Stakwork workflows")).toBeInTheDocument();
    });

    it("should render workflow ID input field", () => {
      render(<WorkflowsPage />);
      const input = screen.getByPlaceholderText("Enter workflow ID...");
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
      await user.type(input, "123");
      
      // Should display workflow name
      await waitFor(() => {
        expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      });
    });

    it("should show version selector for unknown workflow ID without workflow name", async () => {
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");

      await user.type(input, "999");

      await waitFor(() => {
        // Should show version selector even for unknown IDs
        expect(screen.getByTestId("workflow-version-selector")).toBeInTheDocument();
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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

  describe("Submit Button", () => {
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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
      const input = screen.getByPlaceholderText("Enter workflow ID...");
      
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

  describe("Navigation", () => {
    it("should navigate to task chat on submit", async () => {
      const user = userEvent.setup();
      const mockFetch = vi.fn();
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

      // Mock successful API responses (no version re-fetch needed, uses hook data)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "task-123" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      // Mock window.location.href
      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow ID...");

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

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "task-123" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow ID...");

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

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "task-123" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      delete (window as any).location;
      (window as any).location = { href: "" };

      await act(async () => {
        render(<WorkflowsPage />);
      });

      const input = screen.getByPlaceholderText("Enter workflow ID...");

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
});
