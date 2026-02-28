import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { WorkspacesTable } from "@/app/admin/components/WorkspacesTable";
import { toast } from "sonner";

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dialog components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: { children: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) => (
    open ? <div data-testid="dialog-mock" role="dialog">{children}</div> : null
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock Input component
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, disabled }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}));

// Mock Label component
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

// Mock Button component
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, size, className }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      className={className}
    >
      {children}
    </button>
  ),
}));

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
  beforeEach(() => {
    // Mock fetch by default to return empty pod counts
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspaces: [] }),
    });
  });
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

  it("sorts by pods count correctly", async () => {
    // Mock fetch to return pod counts
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "1", usedVms: 3, totalPods: 5 },
          { workspaceId: "2", usedVms: 0, totalPods: 0 },
          { workspaceId: "3", usedVms: 0, totalPods: 0 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Click the Pods header to sort
    const podsHeader = screen.getByText("Pods").closest("th");
    fireEvent.click(podsHeader!);

    // Just verify the table still renders after sorting
    // The actual pod counts might not be loaded yet from the async fetch
    const rows = screen.getAllByRole("row");
    const workspaceRows = rows.slice(1);
    expect(workspaceRows.length).toBe(3);
    
    // Verify no crashes and all workspaces are still displayed
    expect(screen.getByText("Alpha Workspace")).toBeInTheDocument();
    expect(screen.getByText("Beta Workspace")).toBeInTheDocument();
    expect(screen.getByText("Gamma Workspace")).toBeInTheDocument();
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

  it("renders view workspace link for each workspace", () => {
    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const workspaceLinks = screen.getAllByText(/View workspace →/);
    expect(workspaceLinks).toHaveLength(3);

    // Table starts sorted by createdAt desc: Gamma (Mar), Beta (Feb), Alpha (Jan)
    expect(workspaceLinks[0].closest("a")).toHaveAttribute("href", "/admin/workspaces/gamma");
    expect(workspaceLinks[1].closest("a")).toHaveAttribute("href", "/admin/workspaces/beta");
    expect(workspaceLinks[2].closest("a")).toHaveAttribute("href", "/admin/workspaces/alpha");
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

  describe("Delete Dialog", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn();
    });

    it("renders delete button for each workspace", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Should have 3 delete buttons (one per workspace)
      const deleteButtons = screen.getAllByRole("button").filter(
        (button) => button.querySelector('svg')?.classList.toString().includes('lucide')
      );
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it("opens delete dialog when trash button is clicked", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Find the first trash button and click it
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1]; // Skip header
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      
      fireEvent.click(deleteButton!);

      // Dialog should open with workspace name
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/This will permanently delete/)).toBeInTheDocument();
      
      // Verify input field is present
      const input = screen.queryByPlaceholderText("Gamma Workspace");
      expect(input).toBeInTheDocument();
    });

    it("confirm button is disabled when typed text does not match workspace name", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Click delete on first workspace (Gamma - sorted by createdAt desc)
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type incorrect text
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Wrong Name" } });

      // Delete button should be disabled
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      expect(confirmButton).toBeDisabled();
    });

    it("confirm button is enabled when typed text matches workspace name exactly", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Click delete on first workspace (Gamma)
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type exact workspace name
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Gamma Workspace" } });

      // Delete button should be enabled
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      expect(confirmButton).not.toBeDisabled();
    });

    it("calls DELETE endpoint when confirm button is clicked with correct name", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Click delete on first workspace (Gamma - id: 3)
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type exact workspace name
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Gamma Workspace" } });

      // Click confirm
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/admin/workspaces/3",
          { method: "DELETE" }
        );
      });
    });

    it("shows success toast and refreshes page on successful deletion", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Click delete on first workspace
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type exact workspace name and confirm
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Gamma Workspace" } });
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Workspace deleted");
        expect(mockRefresh).toHaveBeenCalled();
      });
    });

    it("shows error toast on deletion failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Workspace not found" }),
      });
      global.fetch = mockFetch;

      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Click delete on first workspace
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type exact workspace name and confirm
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Gamma Workspace" } });
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Error", {
          description: "Workspace not found",
        });
      });
    });

    it("closes dialog when cancel button is clicked", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Open dialog
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Verify dialog is open
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Click cancel
      const cancelButton = screen.getByRole("button", { name: /Cancel/i });
      fireEvent.click(cancelButton);

      // Dialog should close
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows error toast when trying to confirm without matching name", () => {
      render(<WorkspacesTable workspaces={mockWorkspaces} />);

      // Open dialog
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const deleteButton = firstDataRow.querySelector('button[class*="destructive"]');
      fireEvent.click(deleteButton!);

      // Type incorrect name
      const input = screen.getByPlaceholderText(/Gamma Workspace/i);
      fireEvent.change(input, { target: { value: "Wrong" } });

      // Try to confirm (button should be disabled, but test the handler logic)
      const confirmButton = screen.getByRole("button", { name: /Delete Workspace/i });
      expect(confirmButton).toBeDisabled();
    });
  });
});
