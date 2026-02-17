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

  describe("Published Badge", () => {
    it("should show Published badge for version with published_at timestamp", () => {
      const versions = [
        createMockVersion("version-1", "2024-01-20T10:00:00Z"),
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

      // Should show Published badge in the selected version display
      expect(screen.getByText("Published")).toBeInTheDocument();
    });

    it("should not show Published badge for version with null published_at", () => {
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

      // Should not show Published badge
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
