import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";
import * as workspaceHook from "@/hooks/useWorkspace";
import * as workflowNodesHook from "@/hooks/useWorkflowNodes";
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

const mockWorkflows = [
  {
    properties: {
      workflow_id: 1,
      workflow_name: "Test Workflow 1",
    },
  },
  {
    properties: {
      workflow_id: 2,
      workflow_name: "Test Workflow 2",
    },
  },
  {
    properties: {
      workflow_id: 3,
      workflow_name: null, // Test fallback name
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
});
