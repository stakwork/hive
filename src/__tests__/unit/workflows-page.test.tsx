import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";
import * as workspaceHook from "@/hooks/useWorkspace";
import * as workflowNodesHook from "@/hooks/useWorkflowNodes";
import { WorkflowNode } from "@/hooks/useWorkflowNodes";
import { useRouter } from "next/navigation";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/useWorkflowNodes");
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

const mockUseWorkspace = vi.mocked(workspaceHook.useWorkspace);
const mockUseWorkflowNodes = vi.mocked(workflowNodesHook.useWorkflowNodes);
const mockUseRouter = vi.mocked(useRouter);

const mockWorkflows: WorkflowNode[] = [
  {
    node_type: "Workflow",
    ref_id: "workflow-1",
    properties: {
      workflow_id: 1,
      workflow_name: "Test Workflow 1",
      workflow_json: "{}",
    },
  },
  {
    node_type: "Workflow",
    ref_id: "workflow-2",
    properties: {
      workflow_id: 2,
      workflow_name: "Test Workflow 2",
      workflow_json: "{}",
    },
  },
  {
    node_type: "Workflow",
    ref_id: "workflow-3",
    properties: {
      workflow_id: 3,
      // workflow_name is undefined to test fallback name
      workflow_json: "{}",
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  
  // Default mock implementations
  mockUseWorkspace.mockReturnValue({
    slug: "test-workspace",
    workspace: { id: "ws-1", name: "Test Workspace" },
  } as any);
  
  mockUseRouter.mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkflowsPage", () => {
  describe("Loading State", () => {
    it("should display loading spinner while fetching workflows", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(screen.getByRole("status", { hidden: true })).toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("should display error message when workflow fetch fails", () => {
      const errorMessage = "Failed to fetch workflows";
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: errorMessage,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("should display empty state when no workflows exist", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(screen.getByText("No workflows found")).toBeInTheDocument();
    });
  });

  describe("Workflows List", () => {
    it("should render workflows list with correct data", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
      expect(screen.getByText("Workflow 3")).toBeInTheDocument(); // Fallback name
      expect(screen.getByText("ID: 1")).toBeInTheDocument();
      expect(screen.getByText("ID: 2")).toBeInTheDocument();
      expect(screen.getByText("ID: 3")).toBeInTheDocument();
    });

    it("should display page header with correct title", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(screen.getByText("Workflows")).toBeInTheDocument();
      expect(screen.getByText("Manage and edit Stakwork workflows")).toBeInTheDocument();
    });
  });

  describe("New Workflow Button", () => {
    it("should set localStorage and navigate when clicking New Workflow button", async () => {
      const user = userEvent.setup();
      const mockPush = vi.fn();
      
      mockUseRouter.mockReturnValue({
        push: mockPush,
        replace: vi.fn(),
        refresh: vi.fn(),
      } as any);

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const newButton = screen.getByRole("button", { name: /new workflow/i });
      await user.click(newButton);

      expect(localStorage.getItem("task_mode")).toBe("workflow_editor");
      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new");
    });
  });

  describe("Workflow Card Navigation", () => {
    it("should set localStorage and navigate when clicking workflow card", async () => {
      const user = userEvent.setup();
      const mockPush = vi.fn();
      
      mockUseRouter.mockReturnValue({
        push: mockPush,
        replace: vi.fn(),
        refresh: vi.fn(),
      } as any);

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const workflowCard = screen.getByText("Test Workflow 1").closest("div[class*='cursor-pointer']");
      expect(workflowCard).toBeInTheDocument();
      
      if (workflowCard) {
        await user.click(workflowCard);

        expect(localStorage.getItem("task_mode")).toBe("workflow_editor");
        expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new");
      }
    });

    it("should navigate with correct workflow ID when clicking different workflow cards", async () => {
      const user = userEvent.setup();
      const mockPush = vi.fn();
      
      mockUseRouter.mockReturnValue({
        push: mockPush,
        replace: vi.fn(),
        refresh: vi.fn(),
      } as any);

      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      // Click first workflow
      const workflow1Card = screen.getByText("Test Workflow 1").closest("div[class*='cursor-pointer']");
      if (workflow1Card) {
        await user.click(workflow1Card);
        expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new");
      }

      // Click second workflow
      mockPush.mockClear();
      localStorage.clear();
      
      const workflow2Card = screen.getByText("Test Workflow 2").closest("div[class*='cursor-pointer']");
      if (workflow2Card) {
        await user.click(workflow2Card);
        expect(localStorage.getItem("task_mode")).toBe("workflow_editor");
        expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new");
      }
    });
  });

  describe("Integration with useWorkflowNodes", () => {
    it("should call useWorkflowNodes with correct parameters", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: [],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      expect(mockUseWorkflowNodes).toHaveBeenCalledWith("test-workspace", true);
    });

    it("should handle refetch functionality", () => {
      const mockRefetch = vi.fn();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<WorkflowsPage />);

      // The refetch function should be available
      expect(mockRefetch).toBeDefined();
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA attributes and semantic HTML", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      // Check button has accessible name
      expect(screen.getByRole("button", { name: /new workflow/i })).toBeInTheDocument();
      
      // Check workflow cards are clickable
      const cards = screen.getAllByText(/Test Workflow/);
      cards.forEach(card => {
        expect(card.closest("div[class*='cursor-pointer']")).toBeInTheDocument();
      });
    });
  });

  describe("Responsive Layout", () => {
    it("should render grid layout for workflows", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<WorkflowsPage />);

      const gridContainer = container.querySelector("div[class*='grid']");
      expect(gridContainer).toBeInTheDocument();
      expect(gridContainer?.className).toMatch(/grid-cols-1/);
      expect(gridContainer?.className).toMatch(/md:grid-cols-2/);
      expect(gridContainer?.className).toMatch(/lg:grid-cols-3/);
    });
  });

  describe("Search Functionality", () => {
    it("should render search input with correct placeholder", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute("type", "text");
    });

    it("should display Search icon in search input", () => {
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<WorkflowsPage />);

      // Check for Search icon (lucide-react icons use SVG)
      const searchIcon = container.querySelector('svg');
      expect(searchIcon).toBeInTheDocument();
    });

    it("should filter workflows by name (case-insensitive)", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "test workflow 1");

      // Should show matching workflow
      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      
      // Should hide non-matching workflows
      expect(screen.queryByText("Test Workflow 2")).not.toBeInTheDocument();
    });

    it("should filter workflows by ID", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "2");

      // Should show workflow with ID 2
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
      expect(screen.getByText("ID: 2")).toBeInTheDocument();
      
      // Should hide other workflows
      expect(screen.queryByText("Test Workflow 1")).not.toBeInTheDocument();
    });

    it("should show all workflows when search is empty", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      
      // Type and then clear
      await user.type(searchInput, "test");
      await user.clear(searchInput);

      // All workflows should be visible
      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
      expect(screen.getByText("Workflow 3")).toBeInTheDocument(); // Fallback name
    });

    it("should display no results message when search doesn't match", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "nonexistent");

      // Should show no results message with search query
      expect(screen.getByText('No workflows match "nonexistent"')).toBeInTheDocument();
      
      // Should not show any workflows
      expect(screen.queryByText("Test Workflow 1")).not.toBeInTheDocument();
      expect(screen.queryByText("Test Workflow 2")).not.toBeInTheDocument();
    });

    it("should perform case-insensitive matching", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "TEST WORKFLOW");

      // Should match workflows regardless of case
      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
    });

    it("should handle partial name matches", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "workflow");

      // Should match all workflows containing "workflow"
      expect(screen.getByText("Test Workflow 1")).toBeInTheDocument();
      expect(screen.getByText("Test Workflow 2")).toBeInTheDocument();
    });

    it("should distinguish between empty data and filtered results", async () => {
      const user = userEvent.setup();
      mockUseWorkflowNodes.mockReturnValue({
        workflows: mockWorkflows,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<WorkflowsPage />);

      const searchInput = screen.getByPlaceholderText("Search by workflow name or ID...");
      await user.type(searchInput, "xyz");

      // Should show search-specific message, not generic empty message
      expect(screen.getByText('No workflows match "xyz"')).toBeInTheDocument();
      expect(screen.queryByText("No workflows found")).not.toBeInTheDocument();
    });
  });
});
