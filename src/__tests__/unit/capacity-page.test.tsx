// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CapacityPage from "@/app/w/[slug]/capacity/page";
import { mergeMetricsIntoVmData } from "@/lib/pods/capacity-utils";
import * as workspaceHook from "@/hooks/useWorkspace";
import * as poolStatusHook from "@/hooks/usePoolStatus";
import { toast } from "sonner";

// Mock the hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/hooks/usePoolStatus");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

  it("should not show error banner when warning is returned with valid VM data", async () => {
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
          warning: "Real-time metrics partially unavailable",
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    // Warning + populated workspaces → NO error banner
    await waitFor(() => {
      expect(screen.queryByText("Metrics unavailable")).not.toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it("should show error banner when warning is returned with empty workspaces", async () => {
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
          data: { workspaces: [] },
        }),
      });

    render(<CapacityPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    await waitFor(() => {
      const elements = screen.getAllByText("Metrics unavailable");
      expect(elements.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it("should not show error banner on clean success", async () => {
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

describe("mergeMetricsIntoVmData", () => {
  const assignedTask = {
    id: "task-1",
    title: "Fix the bug",
    creator: { id: "user-1", alias: "alice", img: "https://example.com/alice.png" },
  };

  const baseVm = {
    id: "vm-1",
    subdomain: "pod-1",
    state: "pending",
    internal_state: "starting",
    usage_status: "used",
    resource_usage: { available: false },
    assignedTask,
    password: "secret",
  };

  it("preserves assignedTask and other DB-enriched fields when merging metrics", () => {
    const existing = [baseVm] as any[];
    const incoming = [
      {
        id: "vm-1",
        state: "running",
        internal_state: "active",
        resource_usage: { available: true, usage: { cpu: "500m", memory: "512Mi" } },
      },
    ] as any[];

    const result = mergeMetricsIntoVmData(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0].assignedTask).toEqual(assignedTask);
    expect(result[0].password).toBe("secret");
    expect(result[0].state).toBe("running");
    expect(result[0].internal_state).toBe("active");
    expect(result[0].resource_usage).toEqual(incoming[0].resource_usage);
  });

  it("appends incoming VMs that have no matching existing entry", () => {
    const existing = [baseVm] as any[];
    const newVm = { id: "vm-2", state: "running", internal_state: "active", resource_usage: { available: true } };
    const incoming = [
      { ...baseVm, resource_usage: { available: true } },
      newVm,
    ] as any[];

    const result = mergeMetricsIntoVmData(existing, incoming);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(newVm);
    expect(result[1].assignedTask).toBeUndefined();
  });

  it("returns all incoming VMs unchanged when existing is empty", () => {
    const incoming = [
      { id: "vm-1", state: "running", resource_usage: { available: true } },
      { id: "vm-2", state: "pending", resource_usage: { available: false } },
    ] as any[];

    const result = mergeMetricsIntoVmData([], incoming);

    expect(result).toHaveLength(2);
    expect(result).toEqual(incoming);
  });

  it("updates only metrics fields, not other base fields", () => {
    const existing = [baseVm] as any[];
    const incoming = [
      {
        id: "vm-1",
        state: "running",
        internal_state: "active",
        resource_usage: { available: true, usage: { cpu: "250m", memory: "256Mi" } },
        // these should NOT overwrite base
        password: "WRONG",
        assignedTask: null,
      },
    ] as any[];

    const result = mergeMetricsIntoVmData(existing, incoming);

    expect(result[0].password).toBe("secret");
    expect(result[0].assignedTask).toEqual(assignedTask);
    expect(result[0].state).toBe("running");
    expect(result[0].resource_usage.usage.cpu).toBe("250m");
  });
});

describe("CapacityPage - Used pods", () => {
  const usedVm = (overrides: Record<string, unknown> = {}) => ({
    id: "vm-1",
    subdomain: "pod-1",
    state: "running",
    usage_status: "used",
    user_info: null,
    marked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    resource_usage: { available: false },
    ...overrides,
  });

  const setup = (vm: Record<string, unknown>, dropOk = true) => {
    mockUseWorkspace.mockReturnValue({
      workspace: { poolState: "COMPLETE" },
      slug: "test-workspace",
      isAdmin: true,
      isOwner: false,
    } as any);
    mockUsePoolStatus.mockReturnValue({ error: null, refetch: vi.fn() } as any);
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (url.startsWith("/api/pool-manager/drop-pod")) {
        return { ok: dropOk, text: async () => "boom", json: async () => ({ success: dropOk }) };
      }
      if (url.endsWith("/basic-workspaces")) {
        return { ok: true, json: async () => ({ success: true, data: { workspaces: [vm] } }) };
      }
      if (url.endsWith("/pool/workspaces")) {
        return { ok: true, json: async () => ({ success: true, data: { workspaces: [vm] } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
  };

  it("shows since text, creator and user_info holder when no task/job", async () => {
    setup(usedVm({ user_info: "alice@example.com" }));
    render(<CapacityPage />);
    expect(await screen.findByText("alice@example.com")).toBeTruthy();
    expect((await screen.findByTestId("pod-since")).textContent).toMatch(/^since /);
  });

  it("shows task creator name", async () => {
    setup(usedVm({ assignedTask: { id: "t1", title: "My task", creator: { name: "Bob", image: null } } }));
    render(<CapacityPage />);
    expect(await screen.findByText("My task")).toBeTruthy();
    expect((await screen.findByTestId("pod-creator")).textContent).toContain("Bob");
  });

  it("does not show Release for available pods", async () => {
    setup(usedVm({ usage_status: "available" }));
    render(<CapacityPage />);
    await screen.findByText("pod-1");
    expect(screen.queryByRole("button", { name: /release/i })).toBeNull();
  });

  it("releases a pod after confirming, with job param, and refetches", async () => {
    setup(usedVm({ assignedJob: { id: "job-9", title: "J", creator: { name: null, image: null } } }));
    const user = userEvent.setup();
    render(<CapacityPage />);

    await user.click(await screen.findByRole("button", { name: "Release" }));
    const dialog = await screen.findByTestId("release-pod-dialog");
    expect(dialog.textContent).toContain("pod-1");
    expect((global.fetch as any).mock.calls.some((c: any[]) => c[0].startsWith("/api/pool-manager"))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Release" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/pool-manager/drop-pod/test-workspace?podId=vm-1&job=job-9",
        { method: "POST" },
      );
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pod released"));
    const basicCalls = (global.fetch as any).mock.calls.filter((c: any[]) => c[0].endsWith("/basic-workspaces"));
    expect(basicCalls.length).toBe(2);
  });

  it("toasts an error when release fails", async () => {
    setup(usedVm(), false);
    const user = userEvent.setup();
    render(<CapacityPage />);

    await user.click(await screen.findByRole("button", { name: "Release" }));
    const dialog = await screen.findByTestId("release-pod-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Release" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to release pod"));
    expect(global.fetch).toHaveBeenCalledWith("/api/pool-manager/drop-pod/test-workspace?podId=vm-1", {
      method: "POST",
    });
  });
});
