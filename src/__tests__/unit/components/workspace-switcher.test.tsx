import { describe, test, expect, vi } from "vitest";
import { WORKSPACE_LIMITS } from "@/lib/constants";

// Get the actual limit from constants (may vary by environment)
const MAX_LIMIT = WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

// Mock the useWorkspace hook
const mockUseWorkspace = vi.fn();
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

// Mock router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Test data factories
const createWorkspace = (id: string, userRole: string, name: string) => ({
  id,
  userRole,
  name,
});

const createWorkspaceSet = (ownedCount: number, otherRoles: string[] = []) => {
  const workspaces = [];
  
  // Add owned workspaces
  for (let i = 1; i <= ownedCount; i++) {
    workspaces.push(createWorkspace(`owned-${i}`, "OWNER", `Owned Workspace ${i}`));
  }
  
  // Add non-owned workspaces
  otherRoles.forEach((role, index) => {
    workspaces.push(createWorkspace(`${role.toLowerCase()}-${index + 1}`, role, `${role} Workspace ${index + 1}`));
  });
  
  return workspaces;
};

// Helper functions for workspace limit logic
const getOwnedWorkspaces = (workspaces: Array<{userRole: string}>) => 
  workspaces.filter(ws => ws.userRole === 'OWNER');

const isUserAtWorkspaceLimit = (workspaces: Array<{userRole: string}>) => 
  getOwnedWorkspaces(workspaces).length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

describe("WorkspaceSwitcher Logic", () => {
  describe("workspace limit detection", () => {
    test("should identify when user is under workspace limit", () => {
      const workspaces = createWorkspaceSet(MAX_LIMIT - 1, ["DEVELOPER"]);

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(MAX_LIMIT - 1);
      expect(isAtLimit).toBe(false);
    });

    test("should allow creation when well under limit", () => {
      const workspaces = createWorkspaceSet(1, ["DEVELOPER"]);

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(1);
      expect(isAtLimit).toBe(false);
    });

    test("should count only owned workspaces toward limit", () => {
      const workspaces = createWorkspaceSet(MAX_LIMIT - 1, ["ADMIN", "DEVELOPER", "VIEWER"]);

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(MAX_LIMIT - 1);
      expect(workspaces).toHaveLength(MAX_LIMIT - 1 + 3); // owned + non-owned
      expect(isAtLimit).toBe(false);
    });

    test("should be at limit when user owns maximum workspaces", () => {
      const workspaces = createWorkspaceSet(MAX_LIMIT, ["DEVELOPER"]);

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(MAX_LIMIT);
      expect(isAtLimit).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("should handle empty workspace list", () => {
      const workspaces: Array<{userRole: string}> = [];

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(0);
      expect(isAtLimit).toBe(false);
    });

    test("should handle workspaces with no owned workspaces", () => {
      const workspaces = createWorkspaceSet(0, ["ADMIN", "DEVELOPER", "VIEWER"]);

      const ownedWorkspaces = getOwnedWorkspaces(workspaces);
      const isAtLimit = isUserAtWorkspaceLimit(workspaces);

      expect(ownedWorkspaces).toHaveLength(0);
      expect(workspaces).toHaveLength(3); // Only non-owned workspaces
      expect(isAtLimit).toBe(false);
    });
  });
});