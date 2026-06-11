// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
