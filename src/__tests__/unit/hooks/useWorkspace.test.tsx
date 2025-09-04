import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React, { ReactNode } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspaceProvider, WorkspaceContext } from "@/contexts/WorkspaceContext";
import type { WorkspaceContextType } from "@/contexts/WorkspaceContext";
import type { WorkspaceWithAccess, WorkspaceWithRole } from "@/types/workspace";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/w/test-workspace",
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated" }),
}));

describe("useWorkspace Hook Core Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Error Handling Outside Provider", () => {
    test("should throw error when used outside WorkspaceProvider", () => {
      // Render hook without WorkspaceProvider wrapper
      expect(() => {
        renderHook(() => useWorkspace());
      }).toThrow("useWorkspace must be used within a WorkspaceProvider");
    });

    test("should throw exact error message when context is undefined", () => {
      let thrownError: Error | null = null;
      
      try {
        renderHook(() => useWorkspace());
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError?.message).toBe("useWorkspace must be used within a WorkspaceProvider");
    });
  });

  describe("Expected Workspace Utilities", () => {
    const mockWorkspace: WorkspaceWithAccess = {
      id: "workspace-123",
      name: "Test Workspace",
      slug: "test-workspace",
      description: "A test workspace",
      userRole: "ADMIN",
      memberCount: 5,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-02"),
      hasAccess: true,
    };

    const mockWorkspaces: WorkspaceWithRole[] = [
      {
        id: "workspace-123",
        name: "Test Workspace",
        slug: "test-workspace",
        userRole: "ADMIN",
        memberCount: 5,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      },
      {
        id: "workspace-456",
        name: "Another Workspace",
        slug: "another-workspace", 
        userRole: "DEVELOPER",
        memberCount: 3,
        createdAt: new Date("2024-01-03"),
        updatedAt: new Date("2024-01-04"),
      },
    ];

    const mockContextValue: WorkspaceContextType = {
      workspace: mockWorkspace,
      slug: "test-workspace",
      id: "workspace-123",
      role: "ADMIN",
      workspaces: mockWorkspaces,
      loading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      refreshCurrentWorkspace: vi.fn(),
      hasAccess: true,
    };

    test("should return all expected workspace utilities when used within provider", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={mockContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      // Verify current workspace data
      expect(result.current.workspace).toEqual(mockWorkspace);
      expect(result.current.slug).toBe("test-workspace");
      expect(result.current.id).toBe("workspace-123");
      expect(result.current.role).toBe("ADMIN");

      // Verify available workspaces
      expect(result.current.workspaces).toEqual(mockWorkspaces);

      // Verify loading and error states
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.hasAccess).toBe(true);

      // Verify operations are functions
      expect(typeof result.current.switchWorkspace).toBe("function");
      expect(typeof result.current.refreshWorkspaces).toBe("function");
      expect(typeof result.current.refreshCurrentWorkspace).toBe("function");

      // Verify workspace utility functions
      expect(typeof result.current.getWorkspaceById).toBe("function");
      expect(typeof result.current.getWorkspaceBySlug).toBe("function");
      expect(typeof result.current.isCurrentWorkspace).toBe("function");
    });

    test("should return correct values during loading state", () => {
      const loadingContextValue: WorkspaceContextType = {
        ...mockContextValue,
        loading: true,
        workspace: null,
        slug: "",
        id: "",
        role: null,
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={loadingContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.workspace).toBe(null);
      expect(result.current.slug).toBe("");
      expect(result.current.id).toBe("");
      expect(result.current.role).toBe(null);
    });

    test("should return error when context has error state", () => {
      const errorContextValue: WorkspaceContextType = {
        ...mockContextValue,
        error: "Failed to load workspace",
        hasAccess: false,
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={errorContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.error).toBe("Failed to load workspace");
      expect(result.current.hasAccess).toBe(false);
    });
  });

  describe("Role-Based Helpers Accuracy", () => {
    const createContextWithRole = (role: string | null): WorkspaceContextType => ({
      workspace: {
        id: "workspace-123",
        name: "Test Workspace",
        slug: "test-workspace",
        description: "A test workspace",
        userRole: role as any,
        memberCount: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        hasAccess: true,
      },
      slug: "test-workspace",
      id: "workspace-123",
      role: role as any,
      workspaces: [],
      loading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      refreshCurrentWorkspace: vi.fn(),
      hasAccess: true,
    });

    test("should return correct role helpers for OWNER role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("OWNER")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(true);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should return correct role helpers for ADMIN role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("ADMIN")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(true);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should return correct role helpers for PM role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("PM")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(true);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should return correct role helpers for DEVELOPER role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("DEVELOPER")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(true);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should return correct role helpers for STAKEHOLDER role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("STAKEHOLDER")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(true);
      expect(result.current.isViewer).toBe(false);
    });

    test("should return correct role helpers for VIEWER role", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole("VIEWER")}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(true);
    });

    test("should return false for all role helpers when role is null", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={createContextWithRole(null)}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });
  });

  describe("Workspace Utility Functions", () => {
    const mockWorkspaces: WorkspaceWithRole[] = [
      {
        id: "workspace-123",
        name: "Test Workspace",
        slug: "test-workspace",
        userRole: "ADMIN",
        memberCount: 5,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      },
      {
        id: "workspace-456", 
        name: "Another Workspace",
        slug: "another-workspace",
        userRole: "DEVELOPER",
        memberCount: 3,
        createdAt: new Date("2024-01-03"),
        updatedAt: new Date("2024-01-04"),
      },
    ];

    const mockContextValue: WorkspaceContextType = {
      workspace: {
        id: "workspace-123",
        name: "Test Workspace",
        slug: "test-workspace",
        description: "A test workspace",
        userRole: "ADMIN",
        memberCount: 5,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
        hasAccess: true,
      },
      slug: "test-workspace",
      id: "workspace-123",
      role: "ADMIN",
      workspaces: mockWorkspaces,
      loading: false,
      error: null,
      switchWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      refreshCurrentWorkspace: vi.fn(),
      hasAccess: true,
    };

    test("getWorkspaceById should return correct workspace by ID", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={mockContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      const foundWorkspace = result.current.getWorkspaceById("workspace-456");
      expect(foundWorkspace).toEqual(mockWorkspaces[1]);
      expect(foundWorkspace?.name).toBe("Another Workspace");

      const notFoundWorkspace = result.current.getWorkspaceById("non-existent");
      expect(notFoundWorkspace).toBeUndefined();
    });

    test("getWorkspaceBySlug should return correct workspace by slug", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={mockContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      const foundWorkspace = result.current.getWorkspaceBySlug("another-workspace");
      expect(foundWorkspace).toEqual(mockWorkspaces[1]);
      expect(foundWorkspace?.name).toBe("Another Workspace");

      const notFoundWorkspace = result.current.getWorkspaceBySlug("non-existent-slug");
      expect(notFoundWorkspace).toBeUndefined();
    });

    test("isCurrentWorkspace should correctly identify current workspace", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={mockContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      expect(result.current.isCurrentWorkspace("workspace-123")).toBe(true);
      expect(result.current.isCurrentWorkspace("workspace-456")).toBe(false);
      expect(result.current.isCurrentWorkspace("non-existent")).toBe(false);
    });
  });

  describe("Operations Integration", () => {
    test("should call context operations when hook operations are invoked", () => {
      const mockSwitchWorkspace = vi.fn();
      const mockRefreshWorkspaces = vi.fn(); 
      const mockRefreshCurrentWorkspace = vi.fn();

      const mockContextValue: WorkspaceContextType = {
        workspace: null,
        slug: "",
        id: "",
        role: null,
        workspaces: [],
        loading: false,
        error: null,
        switchWorkspace: mockSwitchWorkspace,
        refreshWorkspaces: mockRefreshWorkspaces,
        refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
        hasAccess: false,
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <WorkspaceContext.Provider value={mockContextValue}>
          {children}
        </WorkspaceContext.Provider>
      );

      const { result } = renderHook(() => useWorkspace(), { wrapper });

      // Test switchWorkspace operation
      const testWorkspace = {
        id: "test-workspace",
        name: "Test",
        slug: "test",
        userRole: "ADMIN" as const,
        memberCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      result.current.switchWorkspace(testWorkspace);
      expect(mockSwitchWorkspace).toHaveBeenCalledWith(testWorkspace);

      // Test refreshWorkspaces operation
      result.current.refreshWorkspaces();
      expect(mockRefreshWorkspaces).toHaveBeenCalled();

      // Test refreshCurrentWorkspace operation
      result.current.refreshCurrentWorkspace();
      expect(mockRefreshCurrentWorkspace).toHaveBeenCalled();
    });
  });
});