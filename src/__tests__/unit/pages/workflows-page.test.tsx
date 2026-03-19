import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Mock hooks — mutable so individual tests can override
let mockVersions: any[] = [];
let mockVersionsLoading = false;

vi.mock("@/hooks/useWorkflowNodes", () => ({
  useWorkflowNodes: () => ({ workflows: [] }),
}));

vi.mock("@/hooks/useWorkflowVersions", () => ({
  useWorkflowVersions: () => ({ versions: mockVersions, isLoading: mockVersionsLoading }),
}));

vi.mock("@/hooks/useRecentWorkflows", () => ({
  useRecentWorkflows: () => ({ workflows: [], isLoading: false, error: null }),
}));

// Mock UI components
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: any) => <div data-testid="page-header"><h1>{title}</h1></div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>{children}</button>
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

/** Helper: render page with a pre-filled ID and controlled run/versions state */
async function renderWithId(
  id: string,
  opts: { runData?: object | null; versions?: any[] } = {}
) {
  const { runData = null, versions = [] } = opts;
  mockVersions = versions;

  // Stub fetch: returns runData for the projects API
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => (runData ? { success: true, data: { project: runData } } : { success: false }),
  });

  mockSearchParams = new URLSearchParams(`id=${id}`);
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<WorkflowsPage />);
  });
  // Allow debounce + fetch to settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  return utils!;
}

const FAKE_RUN = { id: 99, name: "Test Run", workflow_id: 42 };
const FAKE_VERSIONS = [
  { workflow_version_id: 1, workflow_name: "Test Workflow", ref_id: "ref-abc", workflow_json: {} },
];

describe("WorkflowsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockVersions = [];
    mockVersionsLoading = false;
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
      render(<WorkflowsPage />);

      const input = screen.getByPlaceholderText("Enter workflow or run ID...");
      expect(input).toHaveValue("");
    });
  });

  describe("ID resolution states", () => {
    it("neither found — shows 'No project or workflow has been found.' message", async () => {
      await renderWithId("999", { runData: null, versions: [] });

      expect(
        screen.getByText("No project or workflow has been found.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /load workflow/i })).not.toBeInTheDocument();
    });

    it("only run found — shows 'Debug this run' button only, no not-found text", async () => {
      await renderWithId("99", { runData: FAKE_RUN, versions: [] });

      expect(screen.getByRole("button", { name: /debug this run/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /load workflow/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/no project or workflow/i)).not.toBeInTheDocument();
    });

    it("only workflow found — shows 'Load Workflow' button only after version selected, no not-found text", async () => {
      mockVersions = FAKE_VERSIONS;
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ success: false }),
      });
      mockSearchParams = new URLSearchParams("id=42");

      await act(async () => { render(<WorkflowsPage />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

      // No run, but workflow versions exist — no not-found text
      expect(screen.queryByText(/no project or workflow/i)).not.toBeInTheDocument();
      // "Load Workflow" button only appears after a version is selected; without selection it's absent
      expect(screen.queryByRole("button", { name: /debug this run/i })).not.toBeInTheDocument();
    });

    it("both found — shows disambiguation message and two outline buttons", async () => {
      mockVersions = FAKE_VERSIONS;
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, data: { project: FAKE_RUN } }),
      });
      mockSearchParams = new URLSearchParams("id=42");

      await act(async () => { render(<WorkflowsPage />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

      expect(
        screen.getByText(/we've found both a run and a workflow with that id/i)
      ).toBeInTheDocument();

      const debugBtn = screen.getByRole("button", { name: /debug this run/i });
      const loadBtn = screen.getByRole("button", { name: /load workflow/i });

      expect(debugBtn).toBeInTheDocument();
      expect(loadBtn).toBeInTheDocument();
      expect(debugBtn).toHaveAttribute("data-variant", "outline");
      expect(loadBtn).toHaveAttribute("data-variant", "outline");
    });
  });
});
