import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowVersionSelector } from "@/components/workflow/WorkflowVersionSelector";
import { WorkflowVersion } from "@/hooks/useWorkflowVersions";

describe("WorkflowVersionSelector", () => {
  const mockOnVersionSelect = vi.fn();

  const createMockVersion = (
    id: string,
    publishedAt?: string | null
  ): WorkflowVersion => ({
    workflow_version_id: id,
    workflow_id: 123,
    workflow_json: JSON.stringify({ nodes: [], edges: [] }),
    workflow_name: "Test Workflow",
    date_added_to_graph: new Date("2024-01-15").toISOString(),
    published: !!publishedAt,
    published_at: publishedAt || null,
    ref_id: `ref-${id}`,
    node_type: "Workflow_version",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Empty State", () => {
    it("should show empty state message when no versions available", () => {
      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={[]}
          selectedVersionId={null}
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      expect(
        screen.getByText("No versions found for this workflow")
      ).toBeInTheDocument();
    });
  });

  describe("Loading State", () => {
    it("should show loading spinner when isLoading is true", () => {
      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={[]}
          selectedVersionId={null}
          onVersionSelect={mockOnVersionSelect}
          isLoading={true}
        />
      );

      // The Loader2 icon should be rendered (check for the spinner container)
      const loadingElement = screen.getByText("Loading versions...");
      expect(loadingElement).toBeInTheDocument();
    });
  });

  describe("Single Version", () => {
    it("should render select component with single version", () => {
      const versions = [createMockVersion("version-1")];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should render the select label
      expect(screen.getByText("Select Version")).toBeInTheDocument();
      
      // Should render the combobox
      const trigger = screen.getByRole("combobox");
      expect(trigger).toBeInTheDocument();
    });

    it("should call onVersionSelect when no version is selected", () => {
      const versions = [createMockVersion("version-1")];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId={null}
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should auto-select the first version
      expect(mockOnVersionSelect).toHaveBeenCalledWith("version-1");
    });
  });

  describe("Multiple Versions", () => {
    it("should render select with multiple versions", () => {
      const versions = [
        createMockVersion("version-1"),
        createMockVersion("version-2"),
        createMockVersion("version-3"),
        createMockVersion("version-4"),
        createMockVersion("version-5"),
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should render the select component
      const trigger = screen.getByRole("combobox");
      expect(trigger).toBeInTheDocument();
      
      // Should render the label
      expect(screen.getByText("Select Version")).toBeInTheDocument();
    });

    it("should render select with 10 versions", () => {
      const versions = Array.from({ length: 10 }, (_, i) =>
        createMockVersion(`version-${i + 1}`)
      );

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should render the select component
      const trigger = screen.getByRole("combobox");
      expect(trigger).toBeInTheDocument();
    });

    it("should show Latest badge for first version", () => {
      const versions = [
        createMockVersion("version-1"),
        createMockVersion("version-2"),
        createMockVersion("version-3"),
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should show Latest badge since first version is selected
      expect(screen.getByText("Latest")).toBeInTheDocument();
    });
  });

  describe("Active / Published Badge", () => {
    it("should show Active badge for the most recently published (first published) version", () => {
      const versions = [
        createMockVersion("version-1", "2024-01-20T10:00:00Z"), // active
        createMockVersion("version-2", "2024-01-10T10:00:00Z"), // older published
        createMockVersion("version-3", null),                    // unpublished
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Only one Active badge (for selected version-1)
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("should show dimmed Published badge for older published versions, not Active", () => {
      const versions = [
        createMockVersion("version-1", "2024-01-20T10:00:00Z"), // active
        createMockVersion("version-2", "2024-01-10T10:00:00Z"), // older published
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-2"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Selected older published version shows "Published" (not "Active")
      expect(screen.getByText("Published")).toBeInTheDocument();
      expect(screen.queryByText("Active")).not.toBeInTheDocument();
    });

    it("should show exactly one Active badge when multiple versions are published", () => {
      const versions = [
        createMockVersion("version-1", "2024-01-20T10:00:00Z"), // active
        createMockVersion("version-2", "2024-01-10T10:00:00Z"), // older published
        createMockVersion("version-3", "2024-01-01T10:00:00Z"), // oldest published
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      const activeBadges = screen.getAllByText("Active");
      expect(activeBadges).toHaveLength(1);
    });

    it("should not show any badge for unpublished versions", () => {
      const versions = [
        createMockVersion("version-1", null),
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      expect(screen.queryByText("Published")).not.toBeInTheDocument();
      expect(screen.queryByText("Active")).not.toBeInTheDocument();
    });

    it("should show no badge when no versions are published", () => {
      const versions = [
        createMockVersion("version-1", null),
        createMockVersion("version-2", null),
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      expect(screen.queryByText("Active")).not.toBeInTheDocument();
      expect(screen.queryByText("Published")).not.toBeInTheDocument();
    });
  });

  describe("Version Selection", () => {
    it("should render combobox for version selection", () => {
      const versions = [
        createMockVersion("version-1"),
        createMockVersion("version-2"),
        createMockVersion("version-3"),
      ];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId="version-1"
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should render the combobox for selection
      const trigger = screen.getByRole("combobox");
      expect(trigger).toBeInTheDocument();
      
      // Should render the select label
      expect(screen.getByText("Select Version")).toBeInTheDocument();
    });
  });

  describe("Version ID Display", () => {
    it("should truncate long version IDs to first 8 characters", () => {
      const longId = "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6";
      const versions = [createMockVersion(longId)];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId={longId}
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should display truncated version (first 8 chars)
      expect(screen.getByText(longId.substring(0, 8))).toBeInTheDocument();
    });

    it("should show full version ID if it is 8 characters or less", () => {
      const shortId = "v1234567";
      const versions = [createMockVersion(shortId)];

      render(
        <WorkflowVersionSelector
          workflowName="Test Workflow"
          versions={versions}
          selectedVersionId={shortId}
          onVersionSelect={mockOnVersionSelect}
          isLoading={false}
        />
      );

      // Should display full version ID
      expect(screen.getByText(shortId)).toBeInTheDocument();
    });
  });
});
