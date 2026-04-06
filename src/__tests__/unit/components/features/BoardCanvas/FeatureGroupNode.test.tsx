// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TASK_NODE_HEIGHT,
  HEADER_HEIGHT,
  GROUP_PADDING,
} from "@/components/features/BoardCanvas";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Import component after mocks
import { FeatureGroupNode } from "@/components/features/BoardCanvas/FeatureGroupNode";
import {
  FEATURE_STATUS_LABELS,
  FEATURE_STATUS_COLORS,
} from "@/types/roadmap";

describe("FeatureGroupNode", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders the feature title", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "f-1",
          title: "My Feature",
          status: "IN_PROGRESS",
          taskCount: 2,
          slug: "test-ws",
        }}
      />,
    );
    expect(screen.getByText("My Feature")).toBeTruthy();
  });

  it("renders the correct status badge label", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "f-1",
          title: "My Feature",
          status: "BACKLOG",
          taskCount: 0,
          slug: "test-ws",
        }}
      />,
    );
    expect(screen.getByTestId("feature-status-badge").textContent).toBe(
      FEATURE_STATUS_LABELS["BACKLOG"],
    );
  });

  it("renders correct status badge for each status", () => {
    const statuses = ["BACKLOG", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
    statuses.forEach((status) => {
      const { unmount } = render(
        <FeatureGroupNode
          data={{
            featureId: "f-1",
            title: "Feature",
            status,
            taskCount: 1,
            slug: "test-ws",
          }}
        />,
      );
      const badge = screen.getByTestId("feature-status-badge");
      expect(badge.textContent).toBe(FEATURE_STATUS_LABELS[status]);
      unmount();
    });
  });

  it("shows 'No tasks' label when taskCount is 0", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "f-1",
          title: "Empty Feature",
          status: "PLANNED",
          taskCount: 0,
          slug: "test-ws",
        }}
      />,
    );
    expect(screen.getByText("No tasks")).toBeTruthy();
  });

  it("does not show 'No tasks' label when taskCount > 0", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "f-1",
          title: "Feature",
          status: "PLANNED",
          taskCount: 3,
          slug: "test-ws",
        }}
      />,
    );
    expect(screen.queryByText("No tasks")).toBeNull();
  });

  it("navigates to plan page when header is clicked", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "feature-abc",
          title: "My Feature",
          status: "IN_PROGRESS",
          taskCount: 1,
          slug: "my-ws",
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("feature-group-header"));
    expect(mockPush).toHaveBeenCalledWith("/w/my-ws/plan/feature-abc");
  });

  it("renders the feature-group-node testid", () => {
    render(
      <FeatureGroupNode
        data={{
          featureId: "f-2",
          title: "Another",
          status: "COMPLETED",
          taskCount: 2,
          slug: "ws",
        }}
      />,
    );
    expect(screen.getByTestId("feature-group-node")).toBeTruthy();
  });
});
