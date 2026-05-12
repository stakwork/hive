/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockSlug = "other-workspace";
let mockWorkspace: { slug: string; repositories: { id: string; name: string }[] } = {
  slug: "other-workspace",
  repositories: [{ id: "repo-1", name: "my-repo" }],
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: mockWorkspace }),
}));

let mockWorkflows: { id: number; name: string; updated_at: string | null; last_modified_by: string | null }[] = [];
let mockWorkflowsLoading = false;

vi.mock("@/hooks/useRecentWorkflows", () => ({
  useRecentWorkflows: () => ({
    workflows: mockWorkflows,
    isLoading: mockWorkflowsLoading,
    error: null,
  }),
}));

// isDevelopmentMode returns false by default (non-dev environment)
vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => false,
}));

// Minimal Select UI mock — must include every named export used by TargetSelector
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="select" data-value={value}>
      {React.Children.map(children, (child) =>
        child ? React.cloneElement(child, { onValueChange }) : null
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <button data-testid="select-trigger">{children}</button>,
  SelectValue: () => <span data-testid="select-value" />,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        child ? React.cloneElement(child, { onValueChange }) : null
      )}
    </div>
  ),
  SelectGroup: ({ children, onValueChange }: any) => (
    <div data-testid="select-group">
      {React.Children.map(children, (child) =>
        child ? React.cloneElement(child, { onValueChange }) : null
      )}
    </div>
  ),
  SelectLabel: ({ children }: any) => <div data-testid="select-label">{children}</div>,
  SelectItem: ({ children, value, onValueChange, ...props }: any) => (
    <button
      data-testid={props["data-testid"] || `select-item-${value}`}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </button>
  ),
  SelectSeparator: () => <hr />,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import {
  TargetSelector,
  encodeTargetValue,
  decodeTargetValue,
  type TargetSelection,
} from "@/components/shared/TargetSelector";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TargetSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlug = "other-workspace";
    mockWorkspace = {
      slug: "other-workspace",
      repositories: [{ id: "repo-1", name: "my-repo" }],
    };
    mockWorkflows = [];
    mockWorkflowsLoading = false;
  });

  describe("non-stakwork workspace", () => {
    it("renders only the Repositories group", () => {
      mockWorkspace = {
        slug: "other-workspace",
        repositories: [
          { id: "repo-1", name: "repo-alpha" },
          { id: "repo-2", name: "repo-beta" },
        ],
      };
      mockWorkflows = [{ id: 10, name: "wf-foo", updated_at: null, last_modified_by: null }];

      render(<TargetSelector value="repo:repo-1" onChange={vi.fn()} />);

      // No "Stak Workflows" label
      expect(screen.queryByText("Stak Workflows")).toBeNull();
      // Repos rendered
      expect(screen.getByTestId("target-repo-repo-1")).toBeTruthy();
      expect(screen.getByTestId("target-repo-repo-2")).toBeTruthy();
      // Workflow NOT rendered
      expect(screen.queryByTestId("target-workflow-10")).toBeNull();
    });

    it("does NOT render Repositories label when no workflow section", () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      expect(screen.queryByText("Repositories")).toBeNull();
    });
  });

  describe("stakwork workspace", () => {
    beforeEach(() => {
      mockWorkspace = {
        slug: "stakwork",
        repositories: [{ id: "repo-1", name: "hive" }],
      };
      mockWorkflows = [
        { id: 42, name: "my-workflow", updated_at: null, last_modified_by: null },
        { id: 99, name: "another-flow", updated_at: null, last_modified_by: null },
      ];
    });

    it("renders both Repositories and Stak Workflows sections", () => {
      render(<TargetSelector value="repo:repo-1" onChange={vi.fn()} />);

      expect(screen.getByText("Repositories")).toBeTruthy();
      expect(screen.getByText("Stak Workflows")).toBeTruthy();
      expect(screen.getByTestId("target-repo-repo-1")).toBeTruthy();
      expect(screen.getByTestId("target-workflow-42")).toBeTruthy();
      expect(screen.getByTestId("target-workflow-99")).toBeTruthy();
    });

    it("emits correct repo selection shape on repo click", async () => {
      const onChange = vi.fn();
      render(<TargetSelector value={undefined} onChange={onChange} />);

      await userEvent.click(screen.getByTestId("target-repo-repo-1"));

      expect(onChange).toHaveBeenCalledWith({
        type: "repo",
        repositoryId: "repo-1",
      });
    });

    it("emits correct workflow selection shape on workflow click", async () => {
      const onChange = vi.fn();
      render(<TargetSelector value={undefined} onChange={onChange} />);

      await userEvent.click(screen.getByTestId("target-workflow-42"));

      expect(onChange).toHaveBeenCalledWith({
        type: "workflow",
        workflowId: 42,
        workflowName: "my-workflow",
        workflowRefId: "", // refId not in RecentWorkflow; caller fetches separately
      });
    });

    it("shows loading text while workflows are loading", () => {
      mockWorkflowsLoading = true;
      mockWorkflows = [];

      render(<TargetSelector value={undefined} onChange={vi.fn()} />);

      expect(screen.getByText("Loading workflows…")).toBeTruthy();
    });
  });

  describe("helper functions", () => {
    it("encodeTargetValue for repo", () => {
      const sel: TargetSelection = { type: "repo", repositoryId: "abc" };
      expect(encodeTargetValue(sel)).toBe("repo:abc");
    });

    it("encodeTargetValue for workflow", () => {
      const sel: TargetSelection = {
        type: "workflow",
        workflowId: 7,
        workflowName: "w",
        workflowRefId: "ref",
      };
      expect(encodeTargetValue(sel)).toBe("workflow:7");
    });

    it("decodeTargetValue for repo string", () => {
      const result = decodeTargetValue("repo:xyz", []);
      expect(result).toEqual({ type: "repo", repositoryId: "xyz" });
    });

    it("decodeTargetValue for workflow string with lookup", () => {
      const workflows = [{ id: 5, name: "flow-five", updated_at: null, last_modified_by: null }];
      const result = decodeTargetValue("workflow:5", workflows);
      expect(result).toMatchObject({ type: "workflow", workflowId: 5, workflowName: "flow-five" });
    });

    it("decodeTargetValue returns null for unknown prefix", () => {
      expect(decodeTargetValue("unknown:abc", [])).toBeNull();
    });

    it("decodeTargetValue returns null for invalid workflow ID", () => {
      expect(decodeTargetValue("workflow:notanumber", [])).toBeNull();
    });
  });
});
