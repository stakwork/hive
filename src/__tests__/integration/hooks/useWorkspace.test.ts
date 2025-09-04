import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import React from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import {
  mockWorkspaces,
  mockCurrentWorkspace,
  createWorkspaceFixture,
  mockApiResponses,
} from "../../utils/workspace-test-utils";

// Mock Next.js auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockUseSession = useSession as vi.MockedFunction<typeof useSession>;
const mockUseRouter = useRouter as vi.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as vi.MockedFunction<typeof usePathname>;

describe("useWorkspace Hook Integration Tests", () => {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter);
    mockUsePathname.mockReturnValue("/w/test-workspace-1");
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: {
        user: { id: "user-1", email: "test@example.com" },
      },
      update: vi.fn(),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Real WorkspaceProvider Integration", () => {
    test("should load workspace data through provider", async () => {
      // Mock API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspaces.success),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspace.success),
        });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider initialSlug="test-workspace-1">
          {children}
        </WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      // Initial loading state
      expect(result.current.loading).toBe(true);

      // Wait for workspace to load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Verify workspace data is loaded
      expect(result.current.workspace).toBeDefined();
      expect(result.current.hasAccess).toBe(true);
      expect(result.current.workspaces).toHaveLength(mockWorkspaces.length);

      // Verify API calls were made
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");
      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/test-workspace-1");
    });

    test("should handle authentication state changes", async () => {
      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      // Start unauthenticated
      mockUseSession.mockReturnValue({
        status: "unauthenticated",
        data: null,
        update: vi.fn(),
      });

      const { result, rerender } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      // Should not have loaded data when unauthenticated
      expect(result.current.loading).toBe(true);
      expect(result.current.workspace).toBeNull();

      // Change to authenticated
      mockUseSession.mockReturnValue({
        status: "authenticated", 
        data: { user: { id: "user-1", email: "test@example.com" } },
        update: vi.fn(),
      });

      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      rerender();

      // Should trigger workspace loading
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");
      });
    });

    test("should handle workspace switching", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const targetWorkspace = mockWorkspaces[1];

      act(() => {
        result.current.switchWorkspace(targetWorkspace);
      });

      // Should navigate to new workspace
      expect(mockRouter.push).toHaveBeenCalledWith(`/w/${targetWorkspace.slug}`);
    });

    test("should handle workspace refresh operations", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspaces.success),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspace.success),
        });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider initialSlug="test-workspace-1">
          {children}
        </WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Test refreshWorkspaces
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      await act(async () => {
        await result.current.refreshWorkspaces();
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/workspaces");

      // Test refreshCurrentWorkspace
      await act(async () => {
        await result.current.refreshCurrentWorkspace();
      });

      // Should trigger a re-fetch of current workspace
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe("Error Handling and Security", () => {
    test("should handle workspace not found error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspaces.success),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve(mockApiResponses.workspace.notFound),
        });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider initialSlug="non-existent-workspace">
          {children}
        </WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.workspace).toBeNull();
      expect(result.current.error).toBe("Workspace not found or access denied");
      expect(result.current.hasAccess).toBe(false);
    });

    test("should handle access denied error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockApiResponses.workspaces.success),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve(mockApiResponses.workspace.forbidden),
        });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider initialSlug="forbidden-workspace">
          {children}
        </WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.workspace).toBeNull();
      expect(result.current.hasAccess).toBe(false);
      expect(result.current.error).toBe("Workspace not found or access denied");
    });

    test("should handle API network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("Failed to load workspaces");
      expect(result.current.workspaces).toHaveLength(0);
    });

    test("should prevent unauthorized access to workspace operations", async () => {
      // Mock unauthorized response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve(mockApiResponses.workspaces.unauthorized),
      });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe("Failed to load workspaces");
      expect(result.current.hasAccess).toBe(false);
    });
  });

  describe("Role-based Access in Real Context", () => {
    test.each([
      { role: "OWNER", shouldHaveAccess: true },
      { role: "ADMIN", shouldHaveAccess: true },
      { role: "DEVELOPER", shouldHaveAccess: true },
      { role: "VIEWER", shouldHaveAccess: true },
    ])("should handle $role role with real provider", async ({ role, shouldHaveAccess }) => {
      const workspaceWithRole = createWorkspaceFixture({
        userRole: role as any,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ workspaces: [workspaceWithRole] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ workspace: workspaceWithRole }),
        });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider initialSlug="test-workspace-1">
          {children}
        </WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBe(role);
      expect(result.current.hasAccess).toBe(shouldHaveAccess);
      
      // Test role-specific flags
      expect(result.current.isOwner).toBe(role === "OWNER");
      expect(result.current.isAdmin).toBe(role === "ADMIN");
      expect(result.current.isDeveloper).toBe(role === "DEVELOPER");
      expect(result.current.isViewer).toBe(role === "VIEWER");
    });
  });

  describe("Workspace Utilities with Real Data", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });
    });

    test("should provide working workspace utilities", async () => {
      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Test getWorkspaceById
      const workspace1 = result.current.getWorkspaceById("workspace-1");
      expect(workspace1).toBeDefined();
      expect(workspace1?.name).toBe("Test Workspace 1");

      // Test getWorkspaceBySlug
      const workspace2 = result.current.getWorkspaceBySlug("test-workspace-2");
      expect(workspace2).toBeDefined();
      expect(workspace2?.name).toBe("Test Workspace 2");

      // Test isCurrentWorkspace
      expect(result.current.isCurrentWorkspace("workspace-1")).toBe(true);
      expect(result.current.isCurrentWorkspace("workspace-2")).toBe(false);
    });

    test("should maintain utility function consistency across updates", async () => {
      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialGetWorkspaceById = result.current.getWorkspaceById;
      const initialGetWorkspaceBySlug = result.current.getWorkspaceBySlug;
      const initialIsCurrentWorkspace = result.current.isCurrentWorkspace;

      // Trigger refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      await act(async () => {
        await result.current.refreshWorkspaces();
      });

      // Utility functions should remain stable (same reference)
      expect(result.current.getWorkspaceById).toBe(initialGetWorkspaceById);
      expect(result.current.getWorkspaceBySlug).toBe(initialGetWorkspaceBySlug);
      expect(result.current.isCurrentWorkspace).toBe(initialIsCurrentWorkspace);
    });
  });

  describe("Performance and Memory Management", () => {
    test("should not cause memory leaks with multiple renders", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result, rerender, unmount } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      // Multiple rerenders should not accumulate listeners or cause issues
      for (let i = 0; i < 10; i++) {
        rerender();
      }

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should still work correctly after multiple rerenders
      expect(result.current.workspaces).toBeDefined();
      expect(result.current.hasAccess).toBe(true);

      // Cleanup should not throw errors
      expect(() => unmount()).not.toThrow();
    });

    test("should handle rapid workspace switches gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponses.workspaces.success),
      });

      const TestWrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider>{children}</WorkspaceProvider>
      );

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: TestWrapper,
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Rapidly switch between workspaces
      const workspaces = mockWorkspaces.slice(0, 3);
      
      act(() => {
        workspaces.forEach((workspace) => {
          result.current.switchWorkspace(workspace);
        });
      });

      // Should handle rapid switches without errors
      expect(mockRouter.push).toHaveBeenCalledTimes(3);
      expect(mockRouter.push).toHaveBeenLastCalledWith(`/w/${workspaces[2].slug}`);
    });
  });
});