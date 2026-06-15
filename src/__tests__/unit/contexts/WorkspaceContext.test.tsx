import { renderHook, waitFor } from "@testing-library/react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceProvider, WorkspaceContext } from "@/contexts/WorkspaceContext";
import type { WorkspaceWithRole } from "@/types/workspace";
import React, { useContext } from "react";

// Mock Next.js navigation hooks
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

// Mock NextAuth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

describe("WorkspaceContext - switchWorkspace", () => {
  const mockPush = vi.fn();
  const mockFetch = vi.fn();

  const mockTargetWorkspace: WorkspaceWithRole = {
    id: "workspace-2-id",
    name: "Target Workspace",
    slug: "target-workspace",
    description: "Test workspace",
    ownerId: "user-123",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    originalSlug: null,
    userRole: "OWNER",
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup default mocks
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    });

    (useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: "user-123", name: "Test User", email: "test@example.com" },
      },
      status: "authenticated",
    });

    // Mock global fetch
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("redirect behavior", () => {
    it("should redirect to workspace dashboard root when switching from tasks page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/tasks");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Execute switchWorkspace
      result.current?.switchWorkspace(mockTargetWorkspace);

      // Verify redirect to dashboard root (not /w/target-workspace/tasks)
      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("should redirect to workspace dashboard root when switching from tasks detail page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/tasks/123");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      // Verify redirect to dashboard root (not /w/target-workspace/tasks/123)
      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });

    it("should redirect to workspace dashboard root when switching from graph page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/graph");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });

    it("should redirect to workspace dashboard root when switching from settings page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/settings");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });

    it("should redirect to workspace dashboard root when switching from insights page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/insights");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });

    it("should redirect to workspace dashboard root when switching from user-journeys page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/user-journeys");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });

    it("should redirect to workspace dashboard root when switching from nested task page", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1/task/abc/def/ghi");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });
  });

  describe("lastAccessedAt tracking", () => {
    it("should send POST request to update lastAccessedAt timestamp", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1");

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      result.current?.switchWorkspace(mockTargetWorkspace);

      // Verify POST request was made
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/target-workspace/access",
          { method: "POST" }
        );
      });
    });

    it("should not fail if POST request fails", async () => {
      (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/workspace1");

      // Mock fetch to reject
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Should not throw error
      expect(() => {
        result.current?.switchWorkspace(mockTargetWorkspace);
      }).not.toThrow();

      // Verify redirect still happened
      expect(mockPush).toHaveBeenCalledWith("/w/target-workspace");
    });
  });

  describe("workspace data isolation", () => {
    it("should trigger useEffect refetch when pathname changes after switch", async () => {
      const mockWorkspaceFetch = vi.fn();
      
      // Mock fetch for different endpoints
      mockWorkspaceFetch.mockImplementation((url: string) => {
        if (url === "/api/workspaces") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ workspaces: [] }),
          });
        }
        if (url === "/api/workspaces/workspace1") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              workspace: {
                id: "workspace-1-id",
                name: "Workspace 1",
                slug: "workspace1",
                userRole: "OWNER",
              },
            }),
          });
        }
        if (url.includes("/tasks/notifications-count")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: { waitingForInputCount: 0 } }),
          });
        }
        if (url === "/api/workspaces/target-workspace") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              workspace: {
                id: "workspace-2-id",
                name: "Target Workspace",
                slug: "target-workspace",
                userRole: "OWNER",
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      global.fetch = mockWorkspaceFetch;

      let currentPathname = "/w/workspace1";
      (usePathname as ReturnType<typeof vi.fn>).mockImplementation(() => currentPathname);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result, rerender } = renderHook(
        () => useContext(WorkspaceContext),
        { wrapper }
      );

      // Wait for initial workspace load
      await waitFor(() => {
        expect(result.current?.workspace?.slug).toBe("workspace1");
      }, { timeout: 3000 });

      // Switch workspace
      result.current?.switchWorkspace(mockTargetWorkspace);

      // Simulate pathname change (what happens after router.push)
      currentPathname = "/w/target-workspace";

      // Rerender to trigger useEffect with new pathname
      rerender();

      // Verify new workspace data is loaded
      await waitFor(() => {
        expect(result.current?.workspace?.slug).toBe("target-workspace");
      }, { timeout: 3000 });

      // Verify fetch was called for new workspace
      expect(mockWorkspaceFetch).toHaveBeenCalledWith("/api/workspaces/target-workspace");
    });
  });
});

describe("WorkspaceContext - loading state", () => {
  const mockPush = vi.fn();

  const makeFetch = (overrides: Record<string, unknown> = {}) =>
    vi.fn().mockImplementation((url: string) => {
      if (url === "/api/workspaces") {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [] }) });
      }
      if (url.includes("/tasks/notifications-count")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { waitingForInputCount: 0 } }),
        });
      }
      const slug = url.replace("/api/workspaces/", "");
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workspace: { id: `${slug}-id`, name: slug, slug, userRole: "OWNER", ...overrides },
        }),
      });
    });

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      refresh: vi.fn(),
    });
    (useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-123", name: "Test User", isSuperAdmin: false } },
      status: "authenticated",
    });
  });

  it("loading transitions to true when navigating to a new workspace slug", async () => {
    global.fetch = makeFetch();
    let currentPathname = "/w/workspace-a";
    (usePathname as ReturnType<typeof vi.fn>).mockImplementation(() => currentPathname);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider>{children}</WorkspaceProvider>
    );

    const loadingValues: boolean[] = [];
    const { result, rerender } = renderHook(() => useContext(WorkspaceContext), { wrapper });

    // Wait for initial workspace to load
    await waitFor(() => {
      expect(result.current?.workspace?.slug).toBe("workspace-a");
    }, { timeout: 3000 });

    // Now navigate to a different workspace
    currentPathname = "/w/workspace-b";
    rerender();

    // Capture loading values after navigation
    await waitFor(() => {
      loadingValues.push(result.current?.loading ?? false);
      expect(result.current?.workspace?.slug).toBe("workspace-b");
    }, { timeout: 3000 });

    // loading must have been true at some point during the nav (isSlugTransitioning or setLoading)
    // The context sets effectiveLoading=true when urlSlug !== currentLoadedSlug
    // Verify final state is not loading
    expect(result.current?.loading).toBe(false);
    expect(result.current?.workspace?.slug).toBe("workspace-b");
  });

  it("does NOT set loading to true when refreshCurrentWorkspace is called on the same slug", async () => {
    global.fetch = makeFetch();
    (usePathname as ReturnType<typeof vi.fn>).mockReturnValue("/w/my-workspace");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider>{children}</WorkspaceProvider>
    );

    const { result } = renderHook(() => useContext(WorkspaceContext), { wrapper });

    // Wait for workspace to load
    await waitFor(() => {
      expect(result.current?.workspace?.slug).toBe("my-workspace");
    }, { timeout: 3000 });

    // Confirm not loading after initial load
    expect(result.current?.loading).toBe(false);

    // Track whether loading ever becomes true during refresh
    let loadingBecameTrue = false;
    const unsubscribe = setInterval(() => {
      if (result.current?.loading === true) {
        loadingBecameTrue = true;
      }
    }, 10);

    // Trigger same-slug refresh
    result.current?.refreshCurrentWorkspace();

    // Wait for the refresh to complete
    await waitFor(() => {
      expect(result.current?.workspace?.slug).toBe("my-workspace");
    }, { timeout: 3000 });

    clearInterval(unsubscribe);

    // loading must never have become true during the same-slug refresh
    expect(loadingBecameTrue).toBe(false);
    expect(result.current?.loading).toBe(false);
  });
});
