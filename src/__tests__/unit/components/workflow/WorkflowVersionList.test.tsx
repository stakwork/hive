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
      makeVersion("v1", false), // unpublished
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v3" onVersionSelect={vi.fn()} />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    // getAllByText would throw if "Active" appears more than once — single badge
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

  it("shows no badge for unpublished versions", () => {
    const versions = [
      makeVersion("v3", true),
      makeVersion("v2", false),
    ];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v3" onVersionSelect={vi.fn()} />
    );

    // Only one badge total (Active for v3); v2 has no badge
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("shows no badges at all when no versions are published", () => {
    const versions = [makeVersion("v1", false), makeVersion("v2", false)];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId="v1" onVersionSelect={vi.fn()} />
    );

    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("highlights the selected version row", () => {
    const versions = [makeVersion("v1", false), makeVersion("v2", false)];
    const { container } = render(
      <WorkflowVersionList versions={versions} selectedVersionId="v1" onVersionSelect={vi.fn()} />
    );

    const buttons = container.querySelectorAll("button");
    // Use classList.contains to avoid false positives from "hover:bg-muted/70"
    expect(buttons[0].classList.contains("bg-muted")).toBe(true);
    expect(buttons[1].classList.contains("bg-muted")).toBe(false);
  });

  it("calls onVersionSelect with the correct ID when a row is clicked", () => {
    const onSelect = vi.fn();
    const versions = [makeVersion("v1", false), makeVersion("v2", false)];
    render(
      <WorkflowVersionList versions={versions} selectedVersionId={null} onVersionSelect={onSelect} />
    );

    screen.getAllByRole("button")[1].click();
    expect(onSelect).toHaveBeenCalledWith("v2");
  });
});

describe("WorkflowVersionList — selectable mode", () => {
  it("renders checkboxes per row when selectable=true", () => {
    const versions = [makeVersion("v1"), makeVersion("v2"), makeVersion("v3")];
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
    const versions = [makeVersion("v1"), makeVersion("v2")];
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
    const versions = [makeVersion("v1"), makeVersion("v2")];
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
    const versions = ["v1", "v2", "v3", "v4", "v5", "v6"].map((id) => makeVersion(id));
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
    const versions = [makeVersion("v1"), makeVersion("v2"), makeVersion("v3")];
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
    const versions = [makeVersion("v1"), makeVersion("v2"), makeVersion("v3")];
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
    const versions = [makeVersion("v1"), makeVersion("v2")];
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
