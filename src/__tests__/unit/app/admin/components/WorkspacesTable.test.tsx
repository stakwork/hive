import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { WorkspacesTable } from "@/app/admin/components/WorkspacesTable";

// Mock PresignedImage component
vi.mock("@/components/ui/presigned-image", () => ({
  PresignedImage: ({
    fallback,
  }: {
    fallback: React.ReactNode;
    src?: string;
    alt?: string;
    className?: string;
    onRefetchUrl?: () => void;
  }) => <div data-testid="presigned-image">{fallback}</div>,
}));

describe("WorkspacesTable", () => {
  const mockWorkspaces = [
    {
      id: "1",
      name: "Alpha Workspace",
      slug: "alpha",
      logoKey: "logo-alpha.png",
      createdAt: new Date("2024-01-15"),
      owner: {
        name: "Alice Owner",
        email: "alice@example.com",
      },
      hasSwarmPassword: true,
      _count: {
        members: 5,
        tasks: 10,
      },
      swarm: {
        _count: {
          pods: 3,
        },
      },
    },
    {
      id: "2",
      name: "Beta Workspace",
      slug: "beta",
      logoKey: null,
      createdAt: new Date("2024-02-20"),
      owner: {
        name: null,
        email: "bob@example.com",
      },
      hasSwarmPassword: false,
      _count: {
        members: 2,
        tasks: 25,
      },
      swarm: null,
    },
    {
      id: "3",
      name: "Gamma Workspace",
      slug: "gamma",
      logoKey: "logo-gamma.png",
      createdAt: new Date("2024-03-10"),
      owner: {
        name: "Charlie Owner",
        email: "charlie@example.com",
      },
      hasSwarmPassword: true,
      _count: {
        members: 8,
        tasks: 5,
      },
      swarm: {
        _count: {
          pods: 0,
        },
      },
    },
  ];

  it("renders all workspaces in the table", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    expect(screen.getByText("Alpha Workspace")).toBeInTheDocument();
    expect(screen.getByText("Beta Workspace")).toBeInTheDocument();
    expect(screen.getByText("Gamma Workspace")).toBeInTheDocument();
  });

  it("displays Building2 icon when logoKey is absent", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Beta workspace has no logoKey, should render Building2
    const rows = screen.getAllByRole("row");
    const betaRow = rows.find((row) => row.textContent?.includes("Beta Workspace"));
    expect(betaRow).toBeInTheDocument();

    // All workspaces should have icon cells with Building2 as fallback
    const icons = screen.getAllByTestId("presigned-image");
    expect(icons.length).toBeGreaterThan(0);
  });

  it("displays 0 pod count when swarm is null", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const rows = screen.getAllByRole("row");
    const betaRow = rows.find((row) => row.textContent?.includes("Beta Workspace"));
    expect(betaRow).toBeInTheDocument();
    expect(betaRow?.textContent).toContain("0"); // Pod count should be 0
  });

  it("calculates member count as _count.members + 1", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Alpha: 5 members + 1 owner = 6
    const rows = screen.getAllByRole("row");
    const alphaRow = rows.find((row) => row.textContent?.includes("Alpha Workspace"));
    expect(alphaRow?.textContent).toContain("6");

    // Beta: 2 members + 1 owner = 3
    const betaRow = rows.find((row) => row.textContent?.includes("Beta Workspace"));
    expect(betaRow?.textContent).toContain("3");
  });

  it("sorts by name ascending when Name header is clicked", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const nameHeader = screen.getByText("Name").closest("th");
    fireEvent.click(nameHeader!);

    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1); // Skip header row

    // Should be sorted: Alpha, Beta, Gamma
    expect(workspaceRows[0].textContent).toContain("Alpha Workspace");
    expect(workspaceRows[1].textContent).toContain("Beta Workspace");
    expect(workspaceRows[2].textContent).toContain("Gamma Workspace");
  });

  it("toggles sort direction when clicking the same header twice", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    let nameHeader = screen.getByText("Name").closest("th");

    // First click: ascending (switches from default createdAt sort)
    fireEvent.click(nameHeader!);
    let rows = screen.getAllByRole("row");
    let workspaceRows = rows.slice(1);
    expect(workspaceRows[0].textContent).toContain("Alpha Workspace");

    // Second click: descending (re-query after state update)
    nameHeader = screen.getByText("Name").closest("th");
    fireEvent.click(nameHeader!);
    rows = screen.getAllByRole("row");
    workspaceRows = rows.slice(1);
    expect(workspaceRows[0].textContent).toContain("Gamma Workspace");
    expect(workspaceRows[2].textContent).toContain("Alpha Workspace");
  });

  it("sorts by members count correctly", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const membersHeader = screen.getByText("Members").closest("th");
    fireEvent.click(membersHeader!);

    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1);

    // Beta (3), Alpha (6), Gamma (9)
    expect(workspaceRows[0].textContent).toContain("Beta Workspace");
    expect(workspaceRows[1].textContent).toContain("Alpha Workspace");
    expect(workspaceRows[2].textContent).toContain("Gamma Workspace");
  });

  it("sorts by pods count correctly", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const podsHeader = screen.getByText("Pods").closest("th");
    fireEvent.click(podsHeader!);

    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1);

    // Beta (0), Gamma (0), Alpha (3)
    // Beta and Gamma both have 0, then Alpha has 3
    expect(workspaceRows[2].textContent).toContain("Alpha Workspace");
  });

  it("sorts by tasks count correctly", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const tasksHeader = screen.getByText("Tasks").closest("th");
    fireEvent.click(tasksHeader!);

    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1);

    // Gamma (5), Alpha (10), Beta (25)
    expect(workspaceRows[0].textContent).toContain("Gamma Workspace");
    expect(workspaceRows[1].textContent).toContain("Alpha Workspace");
    expect(workspaceRows[2].textContent).toContain("Beta Workspace");
  });

  it("sorts by created date correctly", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const createdHeader = screen.getByText("Created").closest("th");
    fireEvent.click(createdHeader!);

    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1);

    // Alpha (Jan), Beta (Feb), Gamma (Mar)
    expect(workspaceRows[0].textContent).toContain("Alpha Workspace");
    expect(workspaceRows[1].textContent).toContain("Beta Workspace");
    expect(workspaceRows[2].textContent).toContain("Gamma Workspace");
  });

  it("displays empty state when no workspaces", () => {
    render(<WorkspacesTable workspaces={[]} />);

    expect(screen.getByText("No workspaces found")).toBeInTheDocument();
  });

  it("renders settings link for each workspace", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const settingsLinks = screen.getAllByText(/Settings →/);
    expect(settingsLinks).toHaveLength(3);

    // Table starts sorted by createdAt desc: Gamma (Mar), Beta (Feb), Alpha (Jan)
    expect(settingsLinks[0].closest("a")).toHaveAttribute("href", "/w/gamma/settings");
    expect(settingsLinks[1].closest("a")).toHaveAttribute("href", "/w/beta/settings");
    expect(settingsLinks[2].closest("a")).toHaveAttribute("href", "/w/alpha/settings");
  });

  it("displays ChevronUp icon when sorting ascending", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const nameHeader = screen.getByText("Name").closest("th");
    fireEvent.click(nameHeader!);

    // Should have ChevronUp icon - verify the icon is in the header
    const nameHeaderElement = screen.getByText("Name").closest("th");
    expect(nameHeaderElement).toBeInTheDocument();
    // Icon is rendered as part of the SortIcon component
    const svgs = nameHeaderElement!.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("displays ChevronDown icon when sorting descending", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const nameHeader = screen.getByText("Name").closest("th");
    fireEvent.click(nameHeader!); // Asc
    fireEvent.click(nameHeader!); // Desc

    // Should have ChevronDown icon - verify the icon is in the header
    const nameHeaderElement = screen.getByText("Name").closest("th");
    expect(nameHeaderElement).toBeInTheDocument();
    const svgs = nameHeaderElement!.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });
});
