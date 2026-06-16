// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SummariseChangesButton } from "@/components/workflow/inspector/SummariseChangesButton";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

// ── MarkdownRenderer mock ────────────────────────────────────────────────────
vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
}));

// ── DropdownMenu mock — always render items inline (no portal/animation) ────
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={disabled ? undefined : onSelect} disabled={disabled}>
      {children}
    </button>
  ),
}));

// ── Tooltip mock ─────────────────────────────────────────────────────────────
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <span>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// ── Pusher mock ──────────────────────────────────────────────────────────────
const mockBind = vi.fn();
const mockUnbindAll = vi.fn();
const mockSubscribe = vi.fn(() => ({
  bind: mockBind,
  unbind_all: mockUnbindAll,
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => ({ subscribe: mockSubscribe })),
  PUSHER_EVENTS: {
    WORKFLOW_SUMMARY_READY: "workflow-summary-ready",
  },
}));

// ── fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── helpers ──────────────────────────────────────────────────────────────────
const makeVersion = (id: string): WorkflowVersion => ({
  workflow_version_id: id,
  workflow_id: 10,
  workflow_json: "{}",
  workflow_name: "Test",
  date_added_to_graph: "1700000000",
  published: false,
  published_at: null,
  ref_id: `ref-${id}`,
  node_type: "Workflow_version",
});

const defaultProps = {
  workspaceSlug: "my-ws",
  workflowId: 10,
  customSelectedIds: [],
  isCustomMode: false,
  onCustomModeToggle: vi.fn(),
  onCustomSelectionConfirm: vi.fn(),
};

describe("SummariseChangesButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the trigger button", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
      />,
    );
    expect(screen.getByRole("button", { name: /summarise changes/i })).toBeInTheDocument();
  });

  it("is disabled when fewer than 2 versions exist", () => {
    render(
      <SummariseChangesButton {...defaultProps} versions={[makeVersion("v1")]} />,
    );
    const btn = screen.getByRole("button", { name: /summarise changes/i });
    expect(btn).toBeDisabled();
  });

  it("is enabled when 2+ versions exist", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
      />,
    );
    const btn = screen.getByRole("button", { name: /summarise changes/i });
    expect(btn).not.toBeDisabled();
  });

  it("shows tooltip hint when fewer than 2 versions", () => {
    render(
      <SummariseChangesButton {...defaultProps} versions={[makeVersion("v1")]} />,
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "Need at least 2 versions to compare",
    );
  });

  it("opens dialog in loading state and calls API with last 5 version IDs on Recent Changes click", async () => {
    const versions = ["v1", "v2", "v3", "v4", "v5", "v6"].map(makeVersion);
    // Keep response pending so dialog stays in loading state
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ cached: false, summaryId: "sum-1" }),
    });

    render(<SummariseChangesButton {...defaultProps} versions={versions} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Summarise Recent Changes"));
    });

    // Dialog should have opened
    expect(screen.getByText("Workflow Changes Summary")).toBeInTheDocument();

    // API called with only first 5
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/workspaces/my-ws/workflows/10/summarise",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ versionIds: ["v1", "v2", "v3", "v4", "v5"] }),
        }),
      ),
    );
  });

  it("shows content state immediately when cached: true is returned", async () => {
    const versions = [makeVersion("v1"), makeVersion("v2")];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        cached: true,
        content: "## Cached summary",
        summaryId: "sum-1",
      }),
    });

    render(<SummariseChangesButton {...defaultProps} versions={versions} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Summarise Recent Changes"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("## Cached summary");
    // Pusher should NOT have been subscribed
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("subscribes to Pusher and transitions to content on matching WORKFLOW_SUMMARY_READY event", async () => {
    const versions = [makeVersion("v1"), makeVersion("v2")];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        cached: false,
        summaryId: "sum-abc",
      }),
    });

    let capturedHandler: ((event: unknown) => void) | null = null;
    mockBind.mockImplementation((_event: string, handler: (e: unknown) => void) => {
      capturedHandler = handler;
    });

    render(<SummariseChangesButton {...defaultProps} versions={versions} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Summarise Recent Changes"));
    });

    // Should be in loading state while waiting for Pusher
    await waitFor(() =>
      expect(screen.getByText("Generating summary…")).toBeInTheDocument(),
    );

    // Simulate Pusher event arriving
    await act(async () => {
      capturedHandler?.({
        summaryId: "sum-abc",
        workflowId: 10,
        content: "## Live summary",
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("## Live summary");
  });

  it("ignores Pusher events with non-matching summaryId", async () => {
    const versions = [makeVersion("v1"), makeVersion("v2")];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        cached: false,
        summaryId: "sum-abc",
      }),
    });

    let capturedHandler: ((event: unknown) => void) | null = null;
    mockBind.mockImplementation((_event: string, handler: (e: unknown) => void) => {
      capturedHandler = handler;
    });

    render(<SummariseChangesButton {...defaultProps} versions={versions} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Summarise Recent Changes"));
    });

    await waitFor(() =>
      expect(screen.getByText("Generating summary…")).toBeInTheDocument(),
    );

    // Event with WRONG summaryId — should be ignored
    await act(async () => {
      capturedHandler?.({
        summaryId: "WRONG-ID",
        workflowId: 10,
        content: "## Should not appear",
      });
    });

    // Still showing loading
    expect(screen.getByText("Generating summary…")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
  });

  it("shows error state when API call fails", async () => {
    const versions = [makeVersion("v1"), makeVersion("v2")];
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(<SummariseChangesButton {...defaultProps} versions={versions} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Summarise Recent Changes"));
    });

    await waitFor(() =>
      expect(screen.getByText("Failed to start summary workflow.")).toBeInTheDocument(),
    );
  });

  it("calls onCustomModeToggle(true) when Custom Summary is clicked", async () => {
    const onCustomModeToggle = vi.fn();
    const versions = [makeVersion("v1"), makeVersion("v2")];

    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={versions}
        onCustomModeToggle={onCustomModeToggle}
      />,
    );

    fireEvent.click(screen.getByText("Custom Summary…"));
    expect(onCustomModeToggle).toHaveBeenCalledWith(true);
  });

  it("Cancel button is visible when isCustomMode=true with 0 selections, Generate Summary is not", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
        isCustomMode={true}
        customSelectedIds={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate summary/i })).not.toBeInTheDocument();
  });

  it("Cancel button is visible when isCustomMode=true with 1 selection, Generate Summary is not", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
        isCustomMode={true}
        customSelectedIds={["v1"]}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate summary/i })).not.toBeInTheDocument();
  });

  it("Cancel and Generate Summary both visible when isCustomMode=true with 2+ selections", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
        isCustomMode={true}
        customSelectedIds={["v1", "v2"]}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate summary/i })).toBeInTheDocument();
  });

  it("Cancel button is absent when isCustomMode=false", () => {
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
        isCustomMode={false}
        customSelectedIds={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("clicking Cancel calls onCustomModeToggle(false)", () => {
    const onCustomModeToggle = vi.fn();
    render(
      <SummariseChangesButton
        {...defaultProps}
        versions={[makeVersion("v1"), makeVersion("v2")]}
        isCustomMode={true}
        customSelectedIds={[]}
        onCustomModeToggle={onCustomModeToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCustomModeToggle).toHaveBeenCalledWith(false);
  });
});
