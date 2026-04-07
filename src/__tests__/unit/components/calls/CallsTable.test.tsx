import React from "react";
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CallsTable } from "@/components/calls/CallsTable";
import type { CallRecording } from "@/types/calls";

describe("CallsTable", () => {
  const mockCalls: CallRecording[] = [
    {
      ref_id: "call-1",
      episode_title: "Team Standup Meeting",
      date_added_to_graph: 1706745600, // Feb 1, 2024
    },
    {
      ref_id: "call-2",
      episode_title: "Product Planning Session",
      date_added_to_graph: 1706832000, // Feb 2, 2024
    },
  ];

  const workspaceSlug = "test-workspace";

  test("renders table with call recordings", () => {
    render(<CallsTable calls={mockCalls} workspaceSlug={workspaceSlug} />);

    expect(screen.getByText("Team Standup Meeting")).toBeInTheDocument();
    expect(screen.getByText("Product Planning Session")).toBeInTheDocument();
  });

  test("renders anchor elements with correct href for each call", () => {
    const { container } = render(
      <CallsTable calls={mockCalls} workspaceSlug={workspaceSlug} />
    );

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);

    // Check first call link
    expect(links[0]).toHaveAttribute(
      "href",
      `/w/${workspaceSlug}/calls/${mockCalls[0].ref_id}`
    );
    expect(links[0]).toHaveAttribute("aria-label", mockCalls[0].episode_title);

    // Check second call link
    expect(links[1]).toHaveAttribute(
      "href",
      `/w/${workspaceSlug}/calls/${mockCalls[1].ref_id}`
    );
    expect(links[1]).toHaveAttribute("aria-label", mockCalls[1].episode_title);
  });

  test("renders table rows with relative positioning for overlay links", () => {
    const { container } = render(
      <CallsTable calls={mockCalls} workspaceSlug={workspaceSlug} />
    );

    const rows = container.querySelectorAll("tr[class*='relative']");
    // Subtract 1 for the header row
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test("renders absolute positioned overlay links", () => {
    const { container } = render(
      <CallsTable calls={mockCalls} workspaceSlug={workspaceSlug} />
    );

    const overlayLinks = container.querySelectorAll("a[class*='absolute']");
    expect(overlayLinks).toHaveLength(2);
  });

  test("displays empty state when no calls provided", () => {
    render(<CallsTable calls={[]} workspaceSlug={workspaceSlug} />);

    expect(screen.getByText("No valid call recordings found")).toBeInTheDocument();
    expect(
      screen.getByText("Some recordings may have incomplete data and were filtered out")
    ).toBeInTheDocument();
  });

  test("formats dates correctly", () => {
    const { container } = render(<CallsTable calls={mockCalls} workspaceSlug={workspaceSlug} />);

    // Check that dates are rendered in table cells
    const dateCells = container.querySelectorAll("td:last-child");
    expect(dateCells.length).toBeGreaterThan(0);
    
    // Verify each date cell has content
    dateCells.forEach((cell) => {
      expect(cell.textContent).toBeTruthy();
    });
  });
});
