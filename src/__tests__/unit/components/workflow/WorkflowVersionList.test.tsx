// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowVersionList } from "@/components/workflow/inspector/WorkflowVersionList";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

const makeVersion = (id: string, published = false): WorkflowVersion => ({
  workflow_version_id: id,
  workflow_id: 1,
  workflow_json: "{}",
  workflow_name: "Test Workflow",
  date_added_to_graph: "1700000000",
  published,
  published_at: published ? "2024-01-01T00:00:00Z" : null,
  ref_id: `ref-${id}`,
  node_type: "Workflow_version",
});

// Helper: find a version row by its short ID text (substring(0,8) of the id)
const getVersionRow = (shortId: string) => screen.getByText(shortId);
const queryVersionRow = (shortId: string) => screen.queryByText(shortId);

describe("WorkflowVersionList", () => {
  it("renders empty state when no versions provided", () => {
    render(
      <WorkflowVersionList versions={[]} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );
    expect(screen.getByText("No versions available.")).toBeInTheDocument();
  });

  it("shows Active badge only on the first published version (active)", () => {
    const versions = [
      makeVersion("v3", true),  // active — first published in sorted list
      makeVersion("v2", true),  // older published
      makeVersion("v1", false), // unpublished draft under v2
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v3" onVersionSelect={vi.fn()} />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(1);
  });

  it("shows dimmed Published badge for older published versions", () => {
    const versions = [
      makeVersion("v3", true),  // active
      makeVersion("v2", true),  // older published → should show Published
      makeVersion("v1", false),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v3" onVersionSelect={vi.fn()} />
    );

    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("shows no Published badge for unpublished draft versions inside an open group", () => {
    // v3 published (active, open by default), v2 is a draft under it
    const versions = [
      makeVersion("v3", true),
      makeVersion("v2", false),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v3" onVersionSelect={vi.fn()} />
    );

    // v3 has Active badge; v2 has no badge
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows no badges at all when no versions are published", () => {
    const versions = [makeVersion("v1", false), makeVersion("v2", false)];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v1" onVersionSelect={vi.fn()} />
    );

    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("highlights the selected version row (bg-muted class)", () => {
    // Two published versions — both visible as accordion header triggers
    const versions = [makeVersion("v2", true), makeVersion("v1", true)];
    const { container } = render(
      <WorkflowVersionList versions={versions} selectedVersionId="v2" onVersionSelect={vi.fn()} />
    );

    // Find all buttons and check one has bg-muted
    const allButtons = container.querySelectorAll("button");
    const selectedBtn = Array.from(allButtons).find((btn) =>
      btn.classList.contains("bg-muted")
    );
    expect(selectedBtn).toBeDefined();
  });

  it("calls onVersionSelect with the correct ID when a version row is clicked", () => {
    const onSelect = vi.fn();
    // Two published groups; v2 is newest (open), v1 is collapsed
    const versions = [makeVersion("v2", true), makeVersion("v1", true)];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={onSelect} />
    );

    // v1 is a collapsed group header — clicking its row triggers onVersionSelect
    // The version row button for v1 is inside a CollapsibleTrigger
    // We get the version row button (not the outer trigger) by finding the button with text "v1"
    const v1Button = screen.getByText("v1").closest("button");
    expect(v1Button).not.toBeNull();
    fireEvent.click(v1Button!);
    expect(onSelect).toHaveBeenCalledWith("v1");
  });
});

describe("WorkflowVersionList — selectable mode", () => {
  it("renders checkboxes per row when selectable=true", () => {
    // 3 published versions (all visible as group headers)
    const versions = [makeVersion("v1", true), makeVersion("v2", true), makeVersion("v3", true)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
  });

  it("does not render checkboxes when selectable is false (default)", () => {
    const versions = [makeVersion("v1", true), makeVersion("v2", false)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("calls onSelectionChange when a checkbox is checked", () => {
    const onSelectionChange = vi.fn();
    const versions = [makeVersion("v1", true), makeVersion("v2", true)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(["v1"]);
  });

  it("disables checkboxes when 5 versions are already selected", () => {
    const versions = ["v1", "v2", "v3", "v4", "v5", "v6"].map((id) => makeVersion(id, true));
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={["v1", "v2", "v3", "v4", "v5"]}
        onSelectionChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // v6 checkbox should be disabled (5 already selected and v6 is not in selection)
    expect(checkboxes[5]).toBeDisabled();
    // Already-selected ones should remain enabled
    expect(checkboxes[0]).not.toBeDisabled();
  });

  it("does not show Generate Summary button when fewer than 2 versions selected", () => {
    const versions = [makeVersion("v1", true), makeVersion("v2", true), makeVersion("v3", true)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={["v1"]}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /generate summary/i })).not.toBeInTheDocument();
  });

  it("shows Generate Summary button with count when 2+ versions are selected", () => {
    const versions = [makeVersion("v1", true), makeVersion("v2", true), makeVersion("v3", true)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={["v1", "v2"]}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate summary \(2 selected\)/i }),
    ).toBeInTheDocument();
  });

  it("calls onCustomSelectionConfirm when Generate Summary is clicked", () => {
    const onConfirm = vi.fn();
    const versions = [makeVersion("v1", true), makeVersion("v2", true)];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={["v1", "v2"]}
        onSelectionChange={vi.fn()}
        onCustomSelectionConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate summary/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("WorkflowVersionList — grouped accordion", () => {
  it("newest published group is expanded by default; its draft rows are visible", () => {
    const versions = [
      makeVersion("p2", true),  // newest published — group open by default
      makeVersion("d1"),        // draft under p2
      makeVersion("p1", true),  // older published — collapsed
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    // d1 draft should be visible (p2 group is open)
    expect(getVersionRow("d1")).toBeInTheDocument();
    // p1 has no drafts so nothing hidden — just verify p2 group text present
    expect(getVersionRow("p2")).toBeInTheDocument();
  });

  it("clicking an expanded header collapses it; draft rows leave the DOM", () => {
    const versions = [
      makeVersion("p1", true),
      makeVersion("d1"),
      makeVersion("d2"),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    // d1 and d2 are visible initially (p1 group expanded by default)
    expect(getVersionRow("d1")).toBeInTheDocument();
    expect(getVersionRow("d2")).toBeInTheDocument();

    // Click the CollapsibleTrigger for p1's group (the outer trigger wrapping the version row)
    // The trigger is the element with data-slot="collapsible-trigger" or role button containing "p1"
    const p1Triggers = screen.getAllByRole("button").filter((btn) =>
      btn.textContent?.includes("p1")
    );
    // The outermost trigger for the group is the CollapsibleTrigger button
    // CollapsibleTrigger renders as a button — find the one that is a direct group trigger
    // It's the button that contains p1 text and the chevron
    const groupTrigger = p1Triggers.find(
      (btn) => btn.getAttribute("data-state") !== null
    );
    expect(groupTrigger).toBeDefined();
    fireEvent.click(groupTrigger!);

    // Draft rows should no longer be visible
    expect(queryVersionRow("d1")).not.toBeInTheDocument();
    expect(queryVersionRow("d2")).not.toBeInTheDocument();
  });

  it("clicking a collapsed header expands it; draft rows appear", () => {
    const versions = [
      makeVersion("p2", true), // newest — open by default
      makeVersion("p1", true), // older — collapsed
      makeVersion("d1"),       // draft under p1
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    // d1 is NOT visible initially (p1 group collapsed)
    expect(queryVersionRow("d1")).not.toBeInTheDocument();

    // Find and click the p1 group trigger
    const p1Triggers = screen.getAllByRole("button").filter((btn) =>
      btn.textContent?.includes("p1")
    );
    const groupTrigger = p1Triggers.find(
      (btn) => btn.getAttribute("data-state") !== null
    );
    expect(groupTrigger).toBeDefined();
    fireEvent.click(groupTrigger!);

    // d1 should now be visible
    expect(getVersionRow("d1")).toBeInTheDocument();
  });

  it("Unreleased group renders at top when drafts precede the latest published version", () => {
    const versions = [
      makeVersion("u1"),        // unreleased (newer than any published)
      makeVersion("p1", true),  // published
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    expect(screen.getByText("Unreleased")).toBeInTheDocument();
    // u1 is inside the Unreleased group which starts collapsed
    expect(queryVersionRow("u1")).not.toBeInTheDocument();
  });

  it("Unreleased group expands when clicked", () => {
    const versions = [
      makeVersion("u1"),
      makeVersion("p1", true),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    // Click the Unreleased CollapsibleTrigger
    const unreleasedTrigger = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("data-state") !== null && btn.textContent?.includes("Unreleased")
    );
    expect(unreleasedTrigger).toBeDefined();
    fireEvent.click(unreleasedTrigger!);

    expect(getVersionRow("u1")).toBeInTheDocument();
  });

  it("does not render Unreleased group when all versions are under published headers", () => {
    const versions = [
      makeVersion("p1", true),
      makeVersion("d1"),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={vi.fn()} />
    );

    expect(screen.queryByText("Unreleased")).not.toBeInTheDocument();
  });

  it("selectable mode: checkboxes appear on both published header rows and draft rows inside open group", () => {
    const versions = [
      makeVersion("p1", true),
      makeVersion("d1"),
      makeVersion("d2"),
    ];
    render(
      <WorkflowVersionList
        versions={versions}
        selectedVersionId={null}
        onVersionSelect={vi.fn()}
        selectable
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    );
    // p1 group is open by default, so d1 and d2 are visible → 3 checkboxes total
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
  });
});
