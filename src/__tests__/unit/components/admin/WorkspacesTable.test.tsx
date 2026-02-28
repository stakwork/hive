import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { WorkspacesTable } from "@/app/admin/components/WorkspacesTable";

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("WorkspacesTable polling", () => {
  const mockWorkspaces = [
    {
      id: "ws1",
      name: "Workspace 1",
      slug: "workspace-1",
      logoKey: null,
      createdAt: new Date("2025-01-01"),
      owner: {
        name: "Owner 1",
        email: "owner1@example.com",
      },
      hasSwarmPassword: false,
      _count: {
        members: 5,
        tasks: 10,
      },
    },
    {
      id: "ws2",
      name: "Workspace 2",
      slug: "workspace-2",
      logoKey: null,
      createdAt: new Date("2025-01-02"),
      owner: {
        name: "Owner 2",
        email: "owner2@example.com",
      },
      hasSwarmPassword: false,
      _count: {
        members: 3,
        tasks: 8,
      },
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("fetches pod counts on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
          { workspaceId: "ws2", usedVms: 1, totalPods: 3 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/pods");
    });
  });

  it("renders '—' while initial fetch is pending", () => {
    mockFetch.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Never resolves
        })
    );

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    const podsCells = screen.getAllByText("—");
    expect(podsCells.length).toBeGreaterThan(0);
  });

  it("renders '2 in use / 5 total' after fetch resolves", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
          { workspaceId: "ws2", usedVms: 1, totalPods: 3 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    await vi.waitFor(() => {
      expect(screen.getByText("2 in use / 5 total")).toBeInTheDocument();
      expect(screen.getByText("1 in use / 3 total")).toBeInTheDocument();
    });
  });

  it("polls every 30 seconds", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
          { workspaceId: "ws2", usedVms: 1, totalPods: 3 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Initial fetch
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Advance 30 seconds
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance another 30 seconds
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("clears interval when visibilitychange fires with document.hidden = true", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Initial fetch
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: true,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    // Advance 30 seconds - should NOT fetch
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(1); // Still just the initial fetch

    // Advance another 30 seconds - still no fetch
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches immediately and restarts interval when visibilitychange fires with document.hidden = false", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
        ],
      }),
    });

    render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Initial fetch
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: true,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    // Advance time while hidden - no fetch
    await vi.advanceTimersByTimeAsync(60000);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Simulate tab becoming visible again
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: false,
    });

    document.dispatchEvent(new Event("visibilitychange"));

    // Should fetch immediately
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // And polling should restart
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("cleans up interval and event listener on unmount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaces: [
          { workspaceId: "ws1", usedVms: 2, totalPods: 5 },
        ],
      }),
    });

    const { unmount } = render(<WorkspacesTable workspaces={mockWorkspaces} />);

    // Initial fetch
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Unmount component
    unmount();

    // Advance time - should NOT fetch
    await vi.advanceTimersByTimeAsync(30000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
