import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CapacityPage from "@/app/w/[slug]/capacity/page";
import * as workspaceHook from "@/hooks/useWorkspace";
import * as poolStatusHook from "@/hooks/usePoolStatus";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/usePoolStatus");

// Mock fetch
global.fetch = vi.fn();

const mockUseWorkspace = vi.mocked(workspaceHook.useWorkspace);
const mockUsePoolStatus = vi.mocked(poolStatusHook.usePoolStatus);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CapacityPage - Infinite Loop Fix", () => {
  it("should fetch metrics only once when vmData is loaded", async () => {
    // Setup
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    const basicResponse = {
      success: true,
      data: {
        workspaces: [
          {
            id: "vm-1",
            subdomain: "pod-1",
            state: "running",
            usage_status: "available",
            resource_usage: { available: false },
          },
        ],
      },
    };

    const metricsResponse = {
      success: true,
      data: {
        workspaces: [
          {
            id: "vm-1",
            subdomain: "pod-1",
            state: "running",
            usage_status: "available",
            resource_usage: {
              available: true,
              usage: { cpu: "500m", memory: "512Mi" },
              requests: { cpu: "1000m", memory: "1Gi" },
            },
          },
        ],
      },
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => basicResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => metricsResponse,
      });

    // Render
    render(<CapacityPage />);

    // Wait for both fetches
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Verify fetch was called with correct endpoints
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/w/test-workspace/pool/basic-workspaces"
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/w/test-workspace/pool/workspaces"
    );

    // Wait a bit more to ensure no additional fetches
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should still be only 2 calls
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should not trigger additional fetches when vmData content changes", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    const basicResponse = {
      success: true,
      data: {
        workspaces: [
          {
            id: "vm-1",
            subdomain: "pod-1",
            state: "running",
            usage_status: "available",
            resource_usage: { available: false },
          },
        ],
      },
    };

    const metricsResponse = {
      success: true,
      data: {
        workspaces: [
          {
            id: "vm-1",
            subdomain: "pod-1",
            state: "running",
            usage_status: "used",
            resource_usage: {
              available: true,
              usage: { cpu: "750m", memory: "768Mi" },
              requests: { cpu: "1000m", memory: "1Gi" },
            },
          },
        ],
      },
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => basicResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => metricsResponse,
      });

    render(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // The vmData changed from basic to metrics, but should not trigger re-fetch
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should reset metricsFetched ref when slug changes", async () => {
    // First workspace - set mock BEFORE rendering
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "workspace-1",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { workspaces: [{ id: "vm-1", resource_usage: { available: false } }] },
      }),
    });

    const { rerender } = render(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/w/workspace-1/pool/basic-workspaces");
    });

    const firstCallCount = (global.fetch as any).mock.calls.length;

    // Change workspace
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "workspace-2",
    });

    rerender(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/w/workspace-2/pool/basic-workspaces");
    });

    // Should have made new calls for the new workspace
    expect((global.fetch as any).mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});

describe("CapacityPage - Timeout Handling", () => {
  it("should set metricsError when fetch fails", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    // Basic data succeeds, metrics fail
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaces: [
              {
                id: "vm-1",
                subdomain: "pod-1",
                resource_usage: { available: false },
              },
            ],
          },
        }),
      })
      .mockRejectedValueOnce(new Error("Network error"));

    render(<CapacityPage />);

    // Wait for both calls
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    // Wait for error state to be set - use getAllByText since text appears in VM cards
    await waitFor(() => {
      const elements = screen.getAllByText("Metrics unavailable");
      expect(elements.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it("should set metricsError when API returns warning", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaces: [
              {
                id: "vm-1",
                subdomain: "pod-1",
                resource_usage: { available: false },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          warning: "Real-time metrics unavailable",
          data: {
            workspaces: [
              {
                id: "vm-1",
                subdomain: "pod-1",
                resource_usage: { available: false },
              },
            ],
          },
        }),
      });

    render(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    // Wait for error state to be set - use getAllByText since text appears in VM cards
    await waitFor(() => {
      const elements = screen.getAllByText("Metrics unavailable");
      expect(elements.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it("should clear timeout on successful response", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    // Both calls succeed
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaces: [
              {
                id: "vm-1",
                resource_usage: { available: false },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaces: [
              {
                id: "vm-1",
                resource_usage: {
                  available: true,
                  usage: { cpu: "500m", memory: "512Mi" },
                  requests: { cpu: "1000m", memory: "1Gi" },
                },
              },
            ],
          },
        }),
      });

    render(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Should NOT show error since metrics loaded successfully
    expect(screen.queryByText("Metrics unavailable")).not.toBeInTheDocument();
  });
});

describe("CapacityPage - Manual Refresh", () => {
  it("should handle metrics fetch failures", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    // Basic data succeeds, metrics fail
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { workspaces: [{ id: "vm-1", subdomain: "pod-1", resource_usage: { available: false } }] },
        }),
      })
      .mockRejectedValueOnce(new Error("Fetch failed"));

    render(<CapacityPage />);

    // Wait for both fetches to complete
    await waitFor(() => {
      expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });

    // Should show the "Metrics unavailable" text in the VM card (use getAllByText since it appears in each card)
    const metricsUnavailableElements = screen.getAllByText("Metrics unavailable");
    expect(metricsUnavailableElements.length).toBeGreaterThan(0);
  });

  it("should fetch metrics on component mount", async () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
    });
    mockUsePoolStatus.mockReturnValue({
      error: null,
      refetch: vi.fn(),
    });

    // Both fetches succeed
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { workspaces: [{ id: "vm-1", subdomain: "pod-1", resource_usage: { available: false } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaces: [
              {
                id: "vm-1",
                subdomain: "pod-1",
                resource_usage: {
                  available: true,
                  usage: { cpu: "500m", memory: "512Mi" },
                  requests: { cpu: "1000m", memory: "1Gi" },
                },
              },
            ],
          },
        }),
      });

    render(<CapacityPage />);

    // Verify metrics fetch is called after basic data loads
    await waitFor(() => {
      expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });

    // Verify the endpoints used for progressive loading
    expect((global.fetch as any)).toHaveBeenNthCalledWith(1, "/api/w/test-workspace/pool/basic-workspaces");
    expect((global.fetch as any)).toHaveBeenNthCalledWith(2, "/api/w/test-workspace/pool/workspaces");
  });
});
