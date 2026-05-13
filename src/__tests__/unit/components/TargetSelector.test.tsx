/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockWorkspace: { slug: string; repositories: { id: string; name: string }[] } = {
  slug: "other-workspace",
  repositories: [{ id: "repo-1", name: "my-repo" }],
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: mockWorkspace }),
}));

let mockWorkflows: { ref_id: string; node_type: "Workflow"; properties: { workflow_id: number; workflow_name?: string; workflow_json: string } }[] = [];
let mockWorkflowsLoading = false;

vi.mock("@/hooks/useWorkflowNodes", () => ({
  useWorkflowNodes: () => ({
    workflows: mockWorkflows,
    isLoading: mockWorkflowsLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

// isDevelopmentMode returns false by default (non-dev environment)
vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => false,
}));

// Minimal Select UI mock
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

// Minimal Popover mock
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open, onOpenChange }: any) => (
    <div data-testid="popover" data-open={open}>
      {React.Children.map(children, (child) =>
        child ? React.cloneElement(child, { open, onOpenChange }) : null
      )}
    </div>
  ),
  PopoverTrigger: ({ children, open, onOpenChange, disabled, asChild }: any) => {
    const child = React.Children.only(children) as React.ReactElement;
    return React.cloneElement(child, {
      onClick: () => !disabled && onOpenChange?.(!open),
      disabled,
    });
  },
  PopoverContent: ({ children, open }: any) =>
    open ? <div data-testid="popover-content">{children}</div> : null,
}));

// Minimal Command mock
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div data-testid="command">{children}</div>,
  CommandInput: ({ value, onValueChange, placeholder }: any) => (
    <input
      data-testid="command-input"
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      placeholder={placeholder}
    />
  ),
  CommandList: ({ children }: any) => <div data-testid="command-list">{children}</div>,
  CommandEmpty: ({ children }: any) => <div data-testid="command-empty">{children}</div>,
  CommandGroup: ({ children, heading }: any) => (
    <div data-testid={`command-group-${heading}`}>
      <div data-testid={`command-group-heading`}>{heading}</div>
      {children}
    </div>
  ),
  CommandItem: ({ children, onSelect, value, ...props }: any) => (
    <button
      data-testid={props["data-testid"] || `command-item-${value}`}
      onClick={() => onSelect?.(value)}
    >
      {children}
    </button>
  ),
  CommandSeparator: () => <hr data-testid="command-separator" />,
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
import type { WorkflowNode } from "@/hooks/useWorkflowNodes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowNode(id: number, name?: string): WorkflowNode {
  return {
    ref_id: `ref-${id}`,
    node_type: "Workflow",
    properties: {
      workflow_id: id,
      workflow_name: name,
      workflow_json: "{}",
    },
  };
}

// Opens the popover by clicking the trigger
async function openPopover() {
  await userEvent.click(screen.getByTestId("target-selector-trigger"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TargetSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspace = {
      slug: "other-workspace",
      repositories: [{ id: "repo-1", name: "my-repo" }],
    };
    mockWorkflows = [];
    mockWorkflowsLoading = false;
  });

  // -------------------------------------------------------------------------
  // Non-stakwork workspace — uses plain Select
  // -------------------------------------------------------------------------
  describe("non-stakwork workspace", () => {
    it("renders only the Repositories group via Select", () => {
      mockWorkspace = {
        slug: "other-workspace",
        repositories: [
          { id: "repo-1", name: "repo-alpha" },
          { id: "repo-2", name: "repo-beta" },
        ],
      };
      mockWorkflows = [makeWorkflowNode(10, "wf-foo")];

      render(<TargetSelector value="repo:repo-1" onChange={vi.fn()} />);

      // Uses plain Select (no popover)
      expect(screen.getByTestId("select")).toBeTruthy();
      expect(screen.queryByTestId("popover")).toBeNull();

      // Repos rendered
      expect(screen.getByTestId("target-repo-repo-1")).toBeTruthy();
      expect(screen.getByTestId("target-repo-repo-2")).toBeTruthy();

      // No workflow items
      expect(screen.queryByTestId("target-workflow-10")).toBeNull();
      expect(screen.queryByText("Stak Workflows")).toBeNull();
    });

    it("does NOT render Repositories label (no workflow section)", () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      expect(screen.queryByText("Repositories")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Stakwork workspace — uses Popover + Command combobox
  // -------------------------------------------------------------------------
  describe("stakwork workspace", () => {
    beforeEach(() => {
      mockWorkspace = {
        slug: "stakwork",
        repositories: [{ id: "repo-1", name: "hive" }],
      };
      mockWorkflows = [
        makeWorkflowNode(42, "my-workflow"),
        makeWorkflowNode(99, "another-flow"),
      ];
    });

    it("renders Popover trigger (not plain Select)", () => {
      render(<TargetSelector value="repo:repo-1" onChange={vi.fn()} />);
      expect(screen.getByTestId("popover")).toBeTruthy();
      expect(screen.queryByTestId("select")).toBeNull();
    });

    it("renders both Repositories and Stak Workflows sections after opening", async () => {
      render(<TargetSelector value="repo:repo-1" onChange={vi.fn()} />);
      await openPopover();

      expect(screen.getByTestId("target-repo-repo-1")).toBeTruthy();
      expect(screen.getByTestId("target-workflow-42")).toBeTruthy();
      expect(screen.getByTestId("target-workflow-99")).toBeTruthy();
    });

    it("shows workflow ID (#42) alongside workflow name", async () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      expect(screen.getByText("#42")).toBeTruthy();
      expect(screen.getByText("#99")).toBeTruthy();
    });

    it("emits correct repo selection shape on repo click", async () => {
      const onChange = vi.fn();
      render(<TargetSelector value={undefined} onChange={onChange} />);
      await openPopover();

      await userEvent.click(screen.getByTestId("target-repo-repo-1"));

      expect(onChange).toHaveBeenCalledWith({
        type: "repo",
        repositoryId: "repo-1",
      });
    });

    it("emits correct workflow selection shape with workflowRefId from ref_id", async () => {
      const onChange = vi.fn();
      render(<TargetSelector value={undefined} onChange={onChange} />);
      await openPopover();

      await userEvent.click(screen.getByTestId("target-workflow-42"));

      expect(onChange).toHaveBeenCalledWith({
        type: "workflow",
        workflowId: 42,
        workflowName: "my-workflow",
        workflowRefId: "ref-42",
      });
    });

    it("shows loading text while workflows are loading", async () => {
      mockWorkflowsLoading = true;
      mockWorkflows = [];

      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      expect(screen.getByText("Loading workflows…")).toBeTruthy();
    });

    // -----------------------------------------------------------------------
    // Search / filtering
    // -----------------------------------------------------------------------
    it("filters workflows by name (case-insensitive substring)", async () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      const input = screen.getByTestId("command-input");
      fireEvent.change(input, { target: { value: "another" } });

      // only "another-flow" (99) should be visible
      expect(screen.queryByTestId("target-workflow-99")).toBeTruthy();
      expect(screen.queryByTestId("target-workflow-42")).toBeNull();
    });

    it("filters workflows by partial numeric ID", async () => {
      mockWorkflows = [makeWorkflowNode(12345, "alpha"), makeWorkflowNode(999, "beta")];

      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      const input = screen.getByTestId("command-input");
      fireEvent.change(input, { target: { value: "123" } });

      expect(screen.queryByTestId("target-workflow-12345")).toBeTruthy();
      expect(screen.queryByTestId("target-workflow-999")).toBeNull();
    });

    it("renders CommandEmpty when no workflows match search", async () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      const input = screen.getByTestId("command-input");
      fireEvent.change(input, { target: { value: "xyzzy-no-match" } });

      // Both workflow items hidden
      expect(screen.queryByTestId("target-workflow-42")).toBeNull();
      expect(screen.queryByTestId("target-workflow-99")).toBeNull();
      // CommandEmpty present
      expect(screen.getByTestId("command-empty")).toBeTruthy();
    });

    it("shows all workflows when search is empty", async () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      const input = screen.getByTestId("command-input");
      fireEvent.change(input, { target: { value: "my" } });
      fireEvent.change(input, { target: { value: "" } });

      expect(screen.getByTestId("target-workflow-42")).toBeTruthy();
      expect(screen.getByTestId("target-workflow-99")).toBeTruthy();
    });

    it("uses fallback name 'Workflow N' for unnamed workflows", async () => {
      mockWorkflows = [makeWorkflowNode(777)]; // no name

      render(<TargetSelector value={undefined} onChange={vi.fn()} />);
      await openPopover();

      expect(screen.getByText("Workflow 777")).toBeTruthy();
    });

    it("disabled prop prevents popover from opening", async () => {
      render(<TargetSelector value={undefined} onChange={vi.fn()} disabled />);

      const trigger = screen.getByTestId("target-selector-trigger");
      expect(trigger).toHaveProperty("disabled", true);
    });
  });

  // -------------------------------------------------------------------------
  // Helper functions
  // -------------------------------------------------------------------------
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

    it("decodeTargetValue for workflow string with WorkflowNode lookup", () => {
      const workflows: WorkflowNode[] = [makeWorkflowNode(5, "flow-five")];
      const result = decodeTargetValue("workflow:5", workflows);
      expect(result).toMatchObject({
        type: "workflow",
        workflowId: 5,
        workflowName: "flow-five",
        workflowRefId: "ref-5",
      });
    });

    it("decodeTargetValue uses fallback name when workflow not in list", () => {
      const result = decodeTargetValue("workflow:999", []);
      expect(result).toMatchObject({
        type: "workflow",
        workflowId: 999,
        workflowName: "Workflow 999",
        workflowRefId: "",
      });
    });

    it("decodeTargetValue returns null for unknown prefix", () => {
      expect(decodeTargetValue("unknown:abc", [])).toBeNull();
    });

    it("decodeTargetValue returns null for invalid workflow ID", () => {
      expect(decodeTargetValue("workflow:notanumber", [])).toBeNull();
    });
  });
});
