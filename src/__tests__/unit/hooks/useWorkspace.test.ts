import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspaceContext } from "@/contexts/WorkspaceContext";
import {
  mockContextScenarios,
  MockWorkspaceProvider,
  mockWorkspaces,
  mockCurrentWorkspace,
  createMockWorkspaceContext,
  validRoles,
  getRoleHierarchy,
} from "../../utils/workspace-test-utils";

describe("useWorkspace Hook Business Logic", () => {
  describe("Context Enforcement", () => {
    test("should throw error when used outside WorkspaceProvider", () => {
      // Test that hook enforces workspace context requirement
      expect(() => {
        renderHook(() => useWorkspace());
      }).toThrow("useWorkspace must be used within a WorkspaceProvider");
    });
  });

  describe("Context Access", () => {
    test("should return extended context with additional properties", () => {
      const testContextValue = createMockWorkspaceContext({
        workspace: mockCurrentWorkspace,
        role: "OWNER",
        workspaces: mockWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(
            WorkspaceContext.Provider,
            { value: testContextValue },
            children
          ),
      });

      // Should include original context properties
      expect(result.current.workspace).toBe(testContextValue.workspace);
      expect(result.current.role).toBe(testContextValue.role);
      expect(result.current.workspaces).toBe(testContextValue.workspaces);
      expect(result.current.loading).toBe(testContextValue.loading);
      expect(result.current.error).toBe(testContextValue.error);
      expect(result.current.hasAccess).toBe(testContextValue.hasAccess);
      
      // Should include additional derived properties
      expect(result.current.id).toBe(mockCurrentWorkspace.id);
      expect(result.current.slug).toBe(mockCurrentWorkspace.slug);
      expect(result.current.isOwner).toBe(true);
      expect(result.current.isAdmin).toBe(false);
      
      // Should include utility functions
      expect(typeof result.current.getWorkspaceById).toBe("function");
      expect(typeof result.current.getWorkspaceBySlug).toBe("function");
      expect(typeof result.current.isCurrentWorkspace).toBe("function");
    });
  });

  describe("Derived Properties", () => {
    validRoles.forEach((role) => {
      test(`should provide correct derived properties for ${role}`, () => {
        const contextValue = createMockWorkspaceContext({
          role,
          workspace: { ...mockCurrentWorkspace, userRole: role },
        });

        const { result } = renderHook(() => useWorkspace(), {
          wrapper: ({ children }) =>
            React.createElement(MockWorkspaceProvider, { contextValue }, children),
        });

        // Test role-specific boolean flags
        expect(result.current.isOwner).toBe(role === "OWNER");
        expect(result.current.isAdmin).toBe(role === "ADMIN");
        expect(result.current.isPM).toBe(role === "PM");
        expect(result.current.isDeveloper).toBe(role === "DEVELOPER");
        expect(result.current.isStakeholder).toBe(role === "STAKEHOLDER");
        expect(result.current.isViewer).toBe(role === "VIEWER");

        // Test derived workspace properties
        expect(result.current.id).toBe(contextValue.workspace?.id || "");
        expect(result.current.slug).toBe(contextValue.workspace?.slug || "");
      });
    });

    test("should handle null role gracefully", () => {
      const contextValue = createMockWorkspaceContext({
        role: null,
        workspace: mockCurrentWorkspace,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      // All role flags should be false
      expect(result.current.isOwner).toBe(false);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isPM).toBe(false);
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.isStakeholder).toBe(false);
      expect(result.current.isViewer).toBe(false);
    });

    test("should handle null workspace gracefully", () => {
      const contextValue = createMockWorkspaceContext({
        workspace: null,
        role: "VIEWER",
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      // Should provide empty strings for workspace properties
      expect(result.current.id).toBe("");
      expect(result.current.slug).toBe("");
      expect(result.current.workspace).toBeNull();
    });
  });

  describe("Utility Functions", () => {
    const testWorkspaces = [
      { id: "ws-1", slug: "first-workspace", name: "First Workspace", userRole: "OWNER" as const },
      { id: "ws-2", slug: "second-workspace", name: "Second Workspace", userRole: "ADMIN" as const },
      { id: "ws-3", slug: "third-workspace", name: "Third Workspace", userRole: "VIEWER" as const },
    ];

    beforeEach(() => {
      vi.clearAllMocks();
    });

    test("should find workspace by ID", () => {
      const contextValue = createMockWorkspaceContext({
        workspaces: testWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      expect(result.current.getWorkspaceById("ws-1")).toEqual(testWorkspaces[0]);
      expect(result.current.getWorkspaceById("ws-2")).toEqual(testWorkspaces[1]);
      expect(result.current.getWorkspaceById("nonexistent")).toBeUndefined();
    });

    test("should find workspace by slug", () => {
      const contextValue = createMockWorkspaceContext({
        workspaces: testWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      expect(result.current.getWorkspaceBySlug("first-workspace")).toEqual(testWorkspaces[0]);
      expect(result.current.getWorkspaceBySlug("second-workspace")).toEqual(testWorkspaces[1]);
      expect(result.current.getWorkspaceBySlug("nonexistent")).toBeUndefined();
    });

    test("should identify current workspace correctly", () => {
      const contextValue = createMockWorkspaceContext({
        workspace: testWorkspaces[0], // First workspace is current
        workspaces: testWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      expect(result.current.isCurrentWorkspace("ws-1")).toBe(true);
      expect(result.current.isCurrentWorkspace("ws-2")).toBe(false);
      expect(result.current.isCurrentWorkspace("nonexistent")).toBe(false);
    });

    test("should handle null workspace in current workspace check", () => {
      const contextValue = createMockWorkspaceContext({
        workspace: null,
        workspaces: testWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      expect(result.current.isCurrentWorkspace("ws-1")).toBe(false);
      expect(result.current.isCurrentWorkspace("ws-2")).toBe(false);
    });
  });

  describe("Function Forwarding", () => {
    test("should forward context functions unchanged", () => {
      const mockSwitchWorkspace = vi.fn();
      const mockRefreshWorkspaces = vi.fn();
      const mockRefreshCurrentWorkspace = vi.fn();

      const contextValue = createMockWorkspaceContext({
        switchWorkspace: mockSwitchWorkspace,
        refreshWorkspaces: mockRefreshWorkspaces,
        refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      // Functions should be forwarded as-is
      expect(result.current.switchWorkspace).toBe(mockSwitchWorkspace);
      expect(result.current.refreshWorkspaces).toBe(mockRefreshWorkspaces);
      expect(result.current.refreshCurrentWorkspace).toBe(mockRefreshCurrentWorkspace);

      // Test function calls are forwarded
      result.current.switchWorkspace("test-workspace");
      result.current.refreshWorkspaces();
      result.current.refreshCurrentWorkspace();

      expect(mockSwitchWorkspace).toHaveBeenCalledWith("test-workspace");
      expect(mockRefreshWorkspaces).toHaveBeenCalled();
      expect(mockRefreshCurrentWorkspace).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty workspaces array", () => {
      const contextValue = createMockWorkspaceContext({
        workspaces: [],
        workspace: null,
        role: null,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      expect(result.current.workspaces).toEqual([]);
      expect(result.current.getWorkspaceById("any-id")).toBeUndefined();
      expect(result.current.getWorkspaceBySlug("any-slug")).toBeUndefined();
      expect(result.current.isCurrentWorkspace("any-id")).toBe(false);
    });

    test("should handle workspaces with duplicate IDs", () => {
      const duplicateWorkspaces = [
        { id: "duplicate", slug: "first", name: "First", userRole: "OWNER" as const },
        { id: "duplicate", slug: "second", name: "Second", userRole: "ADMIN" as const },
      ];

      const contextValue = createMockWorkspaceContext({
        workspaces: duplicateWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      // Should return the first match
      const found = result.current.getWorkspaceById("duplicate");
      expect(found).toEqual(duplicateWorkspaces[0]);
    });

    test("should handle workspaces with duplicate slugs", () => {
      const duplicateWorkspaces = [
        { id: "first", slug: "duplicate", name: "First", userRole: "OWNER" as const },
        { id: "second", slug: "duplicate", name: "Second", userRole: "ADMIN" as const },
      ];

      const contextValue = createMockWorkspaceContext({
        workspaces: duplicateWorkspaces,
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: ({ children }) =>
          React.createElement(MockWorkspaceProvider, { contextValue }, children),
      });

      // Should return the first match
      const found = result.current.getWorkspaceBySlug("duplicate");
      expect(found).toEqual(duplicateWorkspaces[0]);
    });
  });
});
