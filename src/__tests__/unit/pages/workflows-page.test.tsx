import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import WorkflowsPage from "@/app/w/[slug]/workflows/page";

// Mock next/navigation
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    slug: "test-workspace",
    workspace: { id: "workspace-1", name: "Test Workspace", slug: "test-workspace" },
    role: "ADMIN",
    isLoading: false,
  }),
}));

// Mock hooks
vi.mock("@/hooks/useWorkflowNodes", () => ({
  useWorkflowNodes: () => ({ workflows: [] }),
}));

vi.mock("@/hooks/useWorkflowVersions", () => ({
  useWorkflowVersions: () => ({ versions: [], isLoading: false }),
}));

vi.mock("@/hooks/useRecentWorkflows", () => ({
  useRecentWorkflows: () => ({ workflows: [], isLoading: false, error: null }),
}));

// Mock UI components
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: any) => <div data-testid="page-header"><h1>{title}</h1></div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ onChange, value, placeholder, ...props }: any) => (
    <input onChange={onChange} value={value} placeholder={placeholder} {...props} />
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/workflow/WorkflowVersionSelector", () => ({
  WorkflowVersionSelector: () => <div data-testid="version-selector" />,
}));

vi.mock("@prisma/client", () => ({
  ArtifactType: { WORKFLOW: "WORKFLOW" },
}));

describe("WorkflowsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("URL parameter pre-fill", () => {
    it("should pre-fill workflow ID input when ?id= is present in URL", () => {
      mockSearchParams = new URLSearchParams("id=12345");

      render(<WorkflowsPage />);

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      expect(input).toHaveValue("12345");
    });

    it("should leave input empty when no ?id= param is present", () => {
      // mockSearchParams is empty from beforeEach
      render(<WorkflowsPage />);

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      expect(input).toHaveValue("");
    });
  });
});
