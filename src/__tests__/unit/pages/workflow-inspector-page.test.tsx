// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import WorkflowInspectorPage from "@/app/w/[slug]/workflows/[workflowId]/page";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

// ── next/navigation ──────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useParams: () => ({ workflowId: "42" }),
  useRouter: () => ({ push: vi.fn() }),
}));

// ── workspace ────────────────────────────────────────────────────────────────
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws" }),
}));

// ── mutable versions state ─────────────────────────────────────────────────
let mockVersions: WorkflowVersion[] = [];
let mockIsLoading = true; // start loading to mirror real async behaviour

vi.mock("@/hooks/useWorkflowVersions", () => ({
  useWorkflowVersions: () => ({ versions: mockVersions, isLoading: mockIsLoading }),
}));

// ── heavy UI sub-components ───────────────────────────────────────────────
vi.mock("@/components/workflow", () => ({
  default: () => <div data-testid="workflow-graph" />,
}));
vi.mock("@/components/workflow/WorkflowVersionSelector", () => ({
  WorkflowVersionSelector: ({ selectedVersionId }: { selectedVersionId: string | null }) => (
    <div data-testid="version-selector" data-selected={selectedVersionId ?? ""} />
  ),
}));
vi.mock("@/components/workflow/inspector/WorkflowVersionList", () => ({
  WorkflowVersionList: ({
    selectedVersionId,
    selectable,
    selectedIds,
    onSelectionChange,
    onCustomSelectionConfirm,
  }: {
    selectedVersionId: string | null;
    selectable?: boolean;
    selectedIds?: string[];
    onSelectionChange?: (ids: string[]) => void;
    onCustomSelectionConfirm?: () => void;
  }) => (
    <div
      data-testid="version-list"
      data-selected={selectedVersionId ?? ""}
      data-selectable={selectable ? "true" : "false"}
    />
  ),
}));
vi.mock("@/components/workflow/inspector/SummariseChangesButton", () => ({
  SummariseChangesButton: ({
    onCustomModeToggle,
  }: {
    onCustomModeToggle: (enabled: boolean) => void;
  }) => (
    <button
      data-testid="summarise-btn"
      onClick={() => onCustomModeToggle(true)}
    >
      Summarise
    </button>
  ),
}));
vi.mock("@/components/workflow/inspector/WorkflowStatsPanel", () => ({
  WorkflowStatsPanel: () => <div />,
}));
vi.mock("@/components/workflow/inspector/WorkflowParamsTable", () => ({
  WorkflowParamsTable: () => <div />,
}));
vi.mock("@/components/workflow/inspector/WorkflowVersionDiff", () => ({
  WorkflowVersionDiff: () => <div />,
}));
vi.mock("@/components/prompts", () => ({
  PromptsPanel: () => <div />,
}));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: any) => <div>{title}</div>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children, value }: any) => (
    <div data-testid={`tab-${value}`}>{children}</div>
  ),
}));
vi.mock("@/lib/workflow/create-workflow-editor-task", () => ({
  createWorkflowEditorTask: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const makeVersion = (id: string, published = false): WorkflowVersion => ({
  workflow_version_id: id,
  workflow_id: 42,
  workflow_json: "{}",
  workflow_name: "Test Workflow",
  date_added_to_graph: "1700000000",
  published,
  published_at: published ? "2024-01-01T00:00:00Z" : null,
  ref_id: `ref-${id}`,
  node_type: "Workflow_version",
});

/**
 * Render the page with loading=true, then "deliver" versions to simulate real
 * async loading — this mirrors production behaviour and avoids the mount-order
 * race between the auto-select effect and the reset-on-workflowId effect.
 */
async function renderWithVersions(versions: WorkflowVersion[]) {
  // Initial render: loading, no versions yet
  mockIsLoading = true;
  mockVersions = [];
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<WorkflowInspectorPage />);
  });

  // Simulate versions arriving from API
  await act(async () => {
    mockIsLoading = false;
    mockVersions = versions;
    utils!.rerender(<WorkflowInspectorPage />);
  });

  return utils!;
}

describe("WorkflowInspectorPage — auto-select version on load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVersions = [];
    mockIsLoading = true;
  });

  it("auto-selects the first published (active) version, skipping unpublished newer versions", async () => {
    await renderWithVersions([
      makeVersion("v3", false), // newest but unpublished
      makeVersion("v2", true),  // active — first published entry
      makeVersion("v1", true),  // older published
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("version-selector").getAttribute("data-selected")).toBe("v2");
    });
  });

  it("falls back to versions[0] when no version is published", async () => {
    await renderWithVersions([
      makeVersion("v3", false),
      makeVersion("v2", false),
      makeVersion("v1", false),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("version-selector").getAttribute("data-selected")).toBe("v3");
    });
  });

  it("selects the only published version when it is both first and active", async () => {
    await renderWithVersions([
      makeVersion("v2", true),  // active
      makeVersion("v1", false), // unpublished
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("version-selector").getAttribute("data-selected")).toBe("v2");
    });
  });

  it("selects versions[0] when it is also the active (published) version", async () => {
    await renderWithVersions([
      makeVersion("v3", true),  // active — also newest
      makeVersion("v2", false),
      makeVersion("v1", false),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("version-selector").getAttribute("data-selected")).toBe("v3");
    });
  });
});

describe("WorkflowInspectorPage — custom picker mode (SummariseChangesButton)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVersions = [];
    mockIsLoading = true;
  });

  it("version list is not selectable by default", async () => {
    await renderWithVersions([makeVersion("v1"), makeVersion("v2")]);
    await waitFor(() => {
      expect(screen.getByTestId("version-list").getAttribute("data-selectable")).toBe("false");
    });
  });

  it("activates selectable mode when SummariseChangesButton calls onCustomModeToggle(true)", async () => {
    await renderWithVersions([makeVersion("v1"), makeVersion("v2")]);

    // SummariseChangesButton mock fires onCustomModeToggle(true) on click
    const summariseBtn = screen.getByTestId("summarise-btn");
    await act(async () => {
      fireEvent.click(summariseBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("version-list").getAttribute("data-selectable")).toBe("true");
    });
  });
});
