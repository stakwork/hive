/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureCard } from "@/components/features/FeatureCard";

// Make React globally available for components that don't import it explicitly
globalThis.React = React;

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/w/test-workspace/plan",
}));

// Mock workspace hook
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    slug: "test-workspace",
  }),
}));

describe("FeatureCard", () => {
  const mockFeature = {
    id: "feature-1",
    title: "Test Feature",
    description: "Test description",
    status: "IN_PROGRESS" as const,
    priority: "HIGH" as const,
    workspaceId: "workspace-1",
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-15T10:00:00Z",
    assigneeId: null,
    assignee: null,
    deploymentStatus: null,
    deployedToStagingAt: null,
    deployedToProductionAt: null,
    _count: {
      stakworkRuns: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Navigation Link", () => {
    it("renders as a link with correct href", () => {
      const { container } = render(<FeatureCard feature={mockFeature} />);
      const link = container.querySelector('a');
      
      expect(link).toBeInTheDocument();
      // The href uses the workspace slug from useWorkspace hook
      const href = link?.getAttribute('href');
      expect(href).toContain('/w/');
      expect(href).toContain('/plan/feature-1');
    });
  });

  describe("Content Display", () => {
    it("displays feature title", () => {
      render(<FeatureCard feature={mockFeature} />);
      expect(screen.getByText("Test Feature")).toBeInTheDocument();
    });

    it("displays feature status", () => {
      render(<FeatureCard feature={mockFeature} />);
      expect(screen.getByText("In Progress")).toBeInTheDocument();
    });

    it("displays priority badge", () => {
      render(<FeatureCard feature={mockFeature} />);
      expect(screen.getByText("High")).toBeInTheDocument();
    });
  });

  describe("Deployment Status", () => {
    it("shows staging badge when deployed to staging", () => {
      const featureWithStaging = {
        ...mockFeature,
        deploymentStatus: "staging",
        deployedToStagingAt: "2024-01-15T12:00:00Z",
      };

      render(<FeatureCard feature={featureWithStaging} />);
      expect(screen.getByText("Staging")).toBeInTheDocument();
    });

    it("shows production badge when deployed to production", () => {
      const featureWithProduction = {
        ...mockFeature,
        deploymentStatus: "production",
        deployedToProductionAt: "2024-01-15T14:00:00Z",
      };

      render(<FeatureCard feature={featureWithProduction} />);
      expect(screen.getByText("Production")).toBeInTheDocument();
    });

    it("hides deployment badge when not deployed", () => {
      render(<FeatureCard feature={mockFeature} />);
      expect(screen.queryByText("Staging")).not.toBeInTheDocument();
      expect(screen.queryByText("Production")).not.toBeInTheDocument();
    });
  });
});
