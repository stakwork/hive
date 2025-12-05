import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThinkingArtifactsDisplay } from "@/components/features/ThinkingArtifactsDisplay";
import type { ThinkingArtifact } from "@/types/stakwork";

describe("ThinkingArtifactsDisplay", () => {
  const mockArtifacts: ThinkingArtifact[] = [
    {
      stepId: "step-1",
      stepName: "Analyzing requirements",
      status: "completed",
      timestamp: "2024-01-01T12:00:00Z",
    },
    {
      stepId: "step-2",
      stepName: "Generating architecture",
      status: "in_progress",
      timestamp: "2024-01-01T12:05:00Z",
    },
    {
      stepId: "step-3",
      stepName: "Creating diagrams",
      status: "pending",
      timestamp: "2024-01-01T12:10:00Z",
    },
  ];

  it("should render all artifacts", () => {
    render(<ThinkingArtifactsDisplay artifacts={mockArtifacts} />);

    expect(screen.getByText("Research Progress")).toBeInTheDocument();
    expect(screen.getByText("Analyzing requirements")).toBeInTheDocument();
    expect(screen.getByText("Generating architecture")).toBeInTheDocument();
    expect(screen.getByText("Creating diagrams")).toBeInTheDocument();
  });

  it("should display correct status badges", () => {
    render(<ThinkingArtifactsDisplay artifacts={mockArtifacts} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("should toggle artifact details on click", async () => {
    const user = userEvent.setup();
    const artifactsWithDetails = [
      {
        ...mockArtifacts[0],
        details: "Step 1 details",
      },
    ];

    render(<ThinkingArtifactsDisplay artifacts={artifactsWithDetails} />);

    // Details should not be visible initially
    expect(screen.queryByText("Step 1 details")).not.toBeInTheDocument();

    // Click to expand
    const button = screen.getByRole("button", { name: /Analyzing requirements/i });
    await user.click(button);

    // Details should be visible after click
    expect(screen.getByText("Step 1 details")).toBeInTheDocument();

    // Click again to collapse
    await user.click(button);

    // Details should be hidden again
    expect(screen.queryByText("Step 1 details")).not.toBeInTheDocument();
  });

  it("should render nothing if no artifacts", () => {
    const { container } = render(<ThinkingArtifactsDisplay artifacts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("should display failed status correctly", () => {
    const failedArtifacts: ThinkingArtifact[] = [
      {
        stepId: "step-failed",
        stepName: "Failed step",
        status: "failed",
        timestamp: "2024-01-01T12:00:00Z",
      },
    ];

    render(<ThinkingArtifactsDisplay artifacts={failedArtifacts} />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
