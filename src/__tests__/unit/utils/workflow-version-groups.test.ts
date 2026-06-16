// @vitest-environment node
import { describe, it, expect } from "vitest";
import { groupWorkflowVersions } from "@/lib/utils/workflow-version-groups";
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

describe("groupWorkflowVersions", () => {
  it("returns empty groups for an empty array", () => {
    const result = groupWorkflowVersions([]);
    expect(result).toEqual({ unreleased: [], groups: [] });
  });

  it("all published → one group per version, no drafts, no unreleased", () => {
    const versions = [
      makeVersion("v3", true),
      makeVersion("v2", true),
      makeVersion("v1", true),
    ];
    const { unreleased, groups } = groupWorkflowVersions(versions);
    expect(unreleased).toHaveLength(0);
    expect(groups).toHaveLength(3);
    expect(groups[0].publishedVersion.workflow_version_id).toBe("v3");
    expect(groups[0].drafts).toHaveLength(0);
    expect(groups[1].publishedVersion.workflow_version_id).toBe("v2");
    expect(groups[1].drafts).toHaveLength(0);
    expect(groups[2].publishedVersion.workflow_version_id).toBe("v1");
    expect(groups[2].drafts).toHaveLength(0);
  });

  it("all unpublished → all in unreleased, no groups", () => {
    const versions = [makeVersion("v3"), makeVersion("v2"), makeVersion("v1")];
    const { unreleased, groups } = groupWorkflowVersions(versions);
    expect(unreleased).toHaveLength(3);
    expect(unreleased.map((v) => v.workflow_version_id)).toEqual(["v3", "v2", "v1"]);
    expect(groups).toHaveLength(0);
  });

  it("mixed: unreleased at top, then published with drafts, then another published", () => {
    // newest-first order: draft, draft, published, draft, published
    const versions = [
      makeVersion("d2"),       // unreleased
      makeVersion("d1"),       // unreleased
      makeVersion("p2", true), // published group 1
      makeVersion("d0"),       // draft under p2
      makeVersion("p1", true), // published group 2 (oldest)
    ];
    const { unreleased, groups } = groupWorkflowVersions(versions);

    expect(unreleased.map((v) => v.workflow_version_id)).toEqual(["d2", "d1"]);
    expect(groups).toHaveLength(2);

    expect(groups[0].publishedVersion.workflow_version_id).toBe("p2");
    expect(groups[0].drafts.map((v) => v.workflow_version_id)).toEqual(["d0"]);

    expect(groups[1].publishedVersion.workflow_version_id).toBe("p1");
    expect(groups[1].drafts).toHaveLength(0);
  });

  it("single published version with trailing unpublished drafts → one group with drafts", () => {
    const versions = [
      makeVersion("p1", true),
      makeVersion("d2"),
      makeVersion("d1"),
    ];
    const { unreleased, groups } = groupWorkflowVersions(versions);

    expect(unreleased).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].publishedVersion.workflow_version_id).toBe("p1");
    expect(groups[0].drafts.map((v) => v.workflow_version_id)).toEqual(["d2", "d1"]);
  });

  it("single unpublished version → all in unreleased", () => {
    const versions = [makeVersion("v1")];
    const { unreleased, groups } = groupWorkflowVersions(versions);
    expect(unreleased).toHaveLength(1);
    expect(groups).toHaveLength(0);
  });

  it("preserves order within unreleased and drafts (newest-first)", () => {
    const versions = [
      makeVersion("u3"),
      makeVersion("u2"),
      makeVersion("p1", true),
      makeVersion("d3"),
      makeVersion("d2"),
      makeVersion("d1"),
    ];
    const { unreleased, groups } = groupWorkflowVersions(versions);
    expect(unreleased.map((v) => v.workflow_version_id)).toEqual(["u3", "u2"]);
    expect(groups[0].drafts.map((v) => v.workflow_version_id)).toEqual(["d3", "d2", "d1"]);
  });
});
