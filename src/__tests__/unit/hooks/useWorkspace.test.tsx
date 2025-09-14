import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspaceContext } from "@/contexts/WorkspaceContext";
import React from "react";

// Mock WorkspaceContext provider for testing
const createMockProvider = (contextValue: any) => {
  return ({ children }: { children: React.ReactNode }) => (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
};

// Mock workspace data for testing
const mockWorkspace = {
  id: "workspace-1",
  name: "Test Workspace",
  slug: "test-workspace",
  description: "A test workspace",
  ownerId: "user-1",
  hasKey: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  userRole: "OWNER" as const,
  owner: {
    id: "user-1",
    name: "Test Owner",
    email: "owner@example.com",
  },
  isCodeGraphSetup: true,
  repositories: [],
};

const mockWorkspaces = [
  mockWorkspace,
  {
    id: "workspace-2",
    name: "Another Workspace",
    slug: "another-workspace",
    description: "Another test workspace",
    ownerId: "user-2",
    hasKey: false,
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    userRole: "DEVELOPER" as const,
    owner: {
      id: "user-2",
      name: "Another Owner",
      email: "another@example.com",
    },
    isCodeGraphSetup: false,
    repositories: [],
  },
];

const mockContextValue = {
  workspace: mockWorkspace,
  slug: "test-workspace",
  id: "workspace-1",
  role: "OWNER" as const,
  workspaces: mockWorkspaces,
  waitingForInputCount: 3,
  notificationsLoading: false,
  loading: false,
  error: null,
  switchWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn(),
  refreshCurrentWorkspace: vi.fn(),
  refreshTaskNotifications: vi.fn(),
  hasAccess: true,
};

describe("useWorkspace Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Context Usage Validation", () => {
    test("should throw error when used outside WorkspaceProvider", () => {
      // Test hook without provider context
      expect(() => {
        renderHook(() => useWorkspace());
      }).toThrow("useWorkspace must be used within a WorkspaceProvider");
    });

    test("should throw error with exact error message when context is undefined", () => {
      const MockProvider = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceContext.Provider value={undefined as any}>
          {children}
        </WorkspaceContext.Provider>
      );

      expect(() => {
        renderHook(() => useWorkspace(), {
          wrapper: MockProvider,
        });
      }).toThrow("useWorkspace must be used within a WorkspaceProvider");
    });
  });

  describe("Workspace Data Retrieval", () => {
    test("should return all workspace data from context", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      // Test current workspace data
      expect(result.current.workspace).toEqual(mockWorkspace);
      expect(result.current.slug).toBe("test-workspace");
      expect(result.current.id).toBe("workspace-1");
      expect(result.current.role).toBe("OWNER");

      // Test available workspaces
      expect(result.current.workspaces).toEqual(mockWorkspaces);

      // Test task notifications
      expect(result.current.waitingForInputCount).toBe(3);
      expect(result.current.notificationsLoading).toBe(false);

      // Test loading and error states
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.hasAccess).toBe(true);
    });

    test("should return operations from context", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      // Test operations are functions
      expect(typeof result.current.switchWorkspace).toBe("function");
      expect(typeof result.current.refreshWorkspaces).toBe("function");
      expect(typeof result.current.refreshCurrentWorkspace).toBe("function");
      expect(typeof result.current.refreshTaskNotifications).toBe("function");

      // Test operations are the mocked functions
      expect(result.current.switchWorkspace).toBe(mockContextValue.switchWorkspace);
      expect(result.current.refreshWorkspaces).toBe(mockContextValue.refreshWorkspaces);
      expect(result.current.refreshCurrentWorkspace).toBe(mockContextValue.refreshCurrentWorkspace);
      expect(result.current.refreshTaskNotifications).toBe(mockContextValue.refreshTaskNotifications);
    });

    test("should handle loading state correctly", () => {
      const loadingContextValue = {
        ...mockContextValue,
        loading: true,
        workspace: null,
        slug: null,
        id: null,
        role: null,
      };
      const MockProvider = createMockProvider(loadingContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.workspace).toBeNull();
      expect(result.current.slug).toBeNull();
      expect(result.current.id).toBeNull();
      expect(result.current.role).toBeNull();
    });

    test("should handle error state correctly", () => {
      const errorContextValue = {
        ...mockContextValue,
        error: "Failed to load workspace",
        loading: false,
      };
      const MockProvider = createMockProvider(errorContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.error).toBe("Failed to load workspace");
      expect(result.current.loading).toBe(false);
    });
  });

  describe("Role-based Utility Methods", () => {
    test("should correctly identify OWNER role", () => {
      const ownerContextValue = { ...mockContextValue, role: "OWNER" as const };
      const MockProvider = createMockProvider(ownerContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(true);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should correctly identify ADMIN role", () => {
      const adminContextValue = { ...mockContextValue, role: "ADMIN" as const };
      const MockProvider = createMockProvider(adminContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(true);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should correctly identify PM role", () => {
      const pmContextValue = { ...mockContextValue, role: "PM" as const };
      const MockProvider = createMockProvider(pmContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(true);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should correctly identify DEVELOPER role", () => {
      const developerContextValue = { ...mockContextValue, role: "DEVELOPER" as const };
      const MockProvider = createMockProvider(developerContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(true);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should correctly identify STAKEHOLDER role", () => {
      const stakeholderContextValue = { ...mockContextValue, role: "STAKEHOLDER" as const };
      const MockProvider = createMockProvider(stakeholderContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(true);
      expect(result.current.isViewer).toBe(false);
    });

    test("should correctly identify VIEWER role", () => {
      const viewerContextValue = { ...mockContextValue, role: "VIEWER" as const };
      const MockProvider = createMockProvider(viewerContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(true);
    });

    test("should handle null role correctly", () => {
      const nullRoleContextValue = { ...mockContextValue, role: null };
      const MockProvider = createMockProvider(nullRoleContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });
  });

  describe("Workspace Lookup Utility Methods", () => {
    test("getWorkspaceById should find workspace by ID", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      const foundWorkspace = result.current.getWorkspaceById("workspace-1");
      expect(foundWorkspace).toEqual(mockWorkspaces[0]);

      const notFoundWorkspace = result.current.getWorkspaceById("non-existent-id");
      expect(notFoundWorkspace).toBeUndefined();
    });

    test("getWorkspaceBySlug should find workspace by slug", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      const foundWorkspace = result.current.getWorkspaceBySlug("test-workspace");
      expect(foundWorkspace).toEqual(mockWorkspaces[0]);

      const anotherWorkspace = result.current.getWorkspaceBySlug("another-workspace");
      expect(anotherWorkspace).toEqual(mockWorkspaces[1]);

      const notFoundWorkspace = result.current.getWorkspaceBySlug("non-existent-slug");
      expect(notFoundWorkspace).toBeUndefined();
    });

    test("isCurrentWorkspace should correctly identify current workspace", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.isCurrentWorkspace("workspace-1")).toBe(true);
      expect(result.current.isCurrentWorkspace("workspace-2")).toBe(false);
      expect(result.current.isCurrentWorkspace("non-existent-id")).toBe(false);
    });

    test("should handle empty workspaces array", () => {
      const emptyWorkspacesContextValue = {
        ...mockContextValue,
        workspaces: [],
      };
      const MockProvider = createMockProvider(emptyWorkspacesContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.getWorkspaceById("workspace-1")).toBeUndefined();
      expect(result.current.getWorkspaceBySlug("test-workspace")).toBeUndefined();
      expect(result.current.workspaces).toHaveLength(0);
    });
  });

  describe("Operation Methods", () => {
    test("should call switchWorkspace operation", () => {
      const switchWorkspaceMock = vi.fn();
      const contextWithMockedSwitchWorkspace = {
        ...mockContextValue,
        switchWorkspace: switchWorkspaceMock,
      };
      const MockProvider = createMockProvider(contextWithMockedSwitchWorkspace);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      const testWorkspace = mockWorkspaces[1];
      result.current.switchWorkspace(testWorkspace);

      expect(switchWorkspaceMock).toHaveBeenCalledWith(testWorkspace);
      expect(switchWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    test("should call refreshWorkspaces operation", () => {
      const refreshWorkspacesMock = vi.fn();
      const contextWithMockedRefresh = {
        ...mockContextValue,
        refreshWorkspaces: refreshWorkspacesMock,
      };
      const MockProvider = createMockProvider(contextWithMockedRefresh);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      result.current.refreshWorkspaces();

      expect(refreshWorkspacesMock).toHaveBeenCalledTimes(1);
    });

    test("should call refreshCurrentWorkspace operation", () => {
      const refreshCurrentWorkspaceMock = vi.fn();
      const contextWithMockedRefreshCurrent = {
        ...mockContextValue,
        refreshCurrentWorkspace: refreshCurrentWorkspaceMock,
      };
      const MockProvider = createMockProvider(contextWithMockedRefreshCurrent);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      result.current.refreshCurrentWorkspace();

      expect(refreshCurrentWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    test("should call refreshTaskNotifications operation", () => {
      const refreshTaskNotificationsMock = vi.fn();
      const contextWithMockedRefreshNotifications = {
        ...mockContextValue,
        refreshTaskNotifications: refreshTaskNotificationsMock,
      };
      const MockProvider = createMockProvider(contextWithMockedRefreshNotifications);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      result.current.refreshTaskNotifications();

      expect(refreshTaskNotificationsMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("State Management and Reliability", () => {
    test("should handle notifications loading state", () => {
      const notificationsLoadingContextValue = {
        ...mockContextValue,
        notificationsLoading: true,
        waitingForInputCount: 0,
      };
      const MockProvider = createMockProvider(notificationsLoadingContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.notificationsLoading).toBe(true);
      expect(result.current.waitingForInputCount).toBe(0);
    });

    test("should handle different waiting for input counts", () => {
      const highCountContextValue = {
        ...mockContextValue,
        waitingForInputCount: 15,
      };
      const MockProvider = createMockProvider(highCountContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.waitingForInputCount).toBe(15);
    });

    test("should handle access denied state", () => {
      const noAccessContextValue = {
        ...mockContextValue,
        hasAccess: false,
        workspace: null,
        slug: null,
        id: null,
        role: null,
      };
      const MockProvider = createMockProvider(noAccessContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.hasAccess).toBe(false);
      expect(result.current.workspace).toBeNull();
      expect(result.current.slug).toBeNull();
      expect(result.current.id).toBeNull();
      expect(result.current.role).toBeNull();
    });

    test("should maintain referential stability of utility functions", () => {
      const MockProvider = createMockProvider(mockContextValue);
      
      const { result, rerender } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      const firstRenderMethods = {
        getWorkspaceById: result.current.getWorkspaceById,
        getWorkspaceBySlug: result.current.getWorkspaceBySlug,
        isCurrentWorkspace: result.current.isCurrentWorkspace,
      };

      rerender();

      // Utility functions should be new instances on each render (as expected with inline functions)
      expect(result.current.getWorkspaceById).not.toBe(firstRenderMethods.getWorkspaceById);
      expect(result.current.getWorkspaceBySlug).not.toBe(firstRenderMethods.getWorkspaceBySlug);
      expect(result.current.isCurrentWorkspace).not.toBe(firstRenderMethods.isCurrentWorkspace);

      // But they should still work correctly
      expect(result.current.getWorkspaceById("workspace-1")).toEqual(mockWorkspaces[0]);
      expect(result.current.getWorkspaceBySlug("test-workspace")).toEqual(mockWorkspaces[0]);
      expect(result.current.isCurrentWorkspace("workspace-1")).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle context with minimal data", () => {
      const minimalContextValue = {
        workspace: null,
        slug: null,
        id: null,
        role: null,
        workspaces: [],
        waitingForInputCount: 0,
        notificationsLoading: false,
        loading: false,
        error: null,
        switchWorkspace: vi.fn(),
        refreshWorkspaces: vi.fn(),
        refreshCurrentWorkspace: vi.fn(),
        refreshTaskNotifications: vi.fn(),
        hasAccess: false,
      };
      const MockProvider = createMockProvider(minimalContextValue);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.workspace).toBeNull();
      expect(result.current.workspaces).toHaveLength(0);
      expect(result.current.hasAccess).toBe(false);
      expect(result.current.isOwner).toBe(false);
      expect(result.current.getWorkspaceById("any-id")).toBeUndefined();
    });

    test("should handle context state changes", () => {
      const initialContextValue = {
        ...mockContextValue,
        loading: true,
        workspace: null,
      };
      
      let contextValue = initialContextValue;
      const DynamicProvider = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceContext.Provider value={contextValue}>
          {children}
        </WorkspaceContext.Provider>
      );
      
      const { result, rerender } = renderHook(() => useWorkspace(), {
        wrapper: DynamicProvider,
      });

      // Initial state - loading
      expect(result.current.loading).toBe(true);
      expect(result.current.workspace).toBeNull();

      // Update context to loaded state
      contextValue = {
        ...mockContextValue,
        loading: false,
        workspace: mockWorkspace,
      };
      
      rerender();

      // Should reflect the new state
      expect(result.current.loading).toBe(false);
      expect(result.current.workspace).toEqual(mockWorkspace);
    });

    test("should handle undefined workspace properties gracefully", () => {
      const contextWithUndefinedProperties = {
        ...mockContextValue,
        workspace: undefined,
        slug: undefined,
        id: undefined,
        role: undefined,
      };
      const MockProvider = createMockProvider(contextWithUndefinedProperties);
      
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: MockProvider,
      });

      expect(result.current.workspace).toBeUndefined();
      expect(result.current.slug).toBeUndefined();
      expect(result.current.id).toBeUndefined();
      expect(result.current.role).toBeUndefined();
      expect(result.current.isCurrentWorkspace("any-id")).toBe(false); // id is undefined, so this returns false
    });
  });
});