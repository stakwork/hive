import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspacesTable } from "@/app/admin/components/WorkspacesTable";

vi.mock("@/components/ui/PresignedImage", () => ({
  default: ({ logoKey }: { logoKey: string }) => <div data-testid={`logo-${logoKey}`} />,
}));

const mockWorkspaces = [
  {
    id: "1",
    name: "Alpha Workspace",
    slug: "alpha",
    logoKey: null,
    createdAt: new Date("2024-01-01"),
    _count: { workspaceMembers: 5, tasks: 10 },
    swarm: { _count: { pods: 2 } },
  },
];

describe("Debug Icons", () => {
  it("debug SVG rendering", () => {
    const { container } = render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const nameHeader = screen.getByText("Name").closest("th");
    console.log("BEFORE CLICK - Name header HTML:", nameHeader?.innerHTML);
    
    fireEvent.click(nameHeader!);
    console.log("AFTER 1st CLICK - Name header HTML:", nameHeader?.innerHTML);
    
    fireEvent.click(nameHeader!);
    console.log("AFTER 2nd CLICK - Name header HTML:", nameHeader?.innerHTML);
    
    // Check all SVGs in the container
    const allSvgs = container.querySelectorAll('svg');
    console.log("Total SVGs found:", allSvgs.length);
    allSvgs.forEach((svg, idx) => {
      console.log(`SVG ${idx}:`, svg.outerHTML);
    });
  });
});
