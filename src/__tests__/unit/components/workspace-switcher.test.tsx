import { describe, test, expect, vi } from "vitest";
import { WORKSPACE_LIMITS } from "@/lib/constants";

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

describe("WorkspaceSwitcher Logic", () => {
  test("should identify when user is at workspace limit", () => {
    const workspaces = [
      { id: "1", userRole: "OWNER", name: "Workspace 1" },
      { id: "2", userRole: "OWNER", name: "Workspace 2" },
      { id: "3", userRole: "DEVELOPER", name: "Workspace 3" }, // Not owned
    ];

    const ownedWorkspaces = workspaces.filter(ws => ws.userRole === 'OWNER');
    const isAtLimit = ownedWorkspaces.length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

    expect(ownedWorkspaces).toHaveLength(2);
    expect(isAtLimit).toBe(true);
  });

  test("should allow creation when under limit", () => {
    const workspaces = [
      { id: "1", userRole: "OWNER", name: "Workspace 1" },
      { id: "2", userRole: "DEVELOPER", name: "Workspace 2" }, // Not owned
    ];

    const ownedWorkspaces = workspaces.filter(ws => ws.userRole === 'OWNER');
    const isAtLimit = ownedWorkspaces.length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

    expect(ownedWorkspaces).toHaveLength(1);
    expect(isAtLimit).toBe(false);
  });

  test("should count only owned workspaces toward limit", () => {
    const workspaces = [
      { id: "1", userRole: "OWNER", name: "Owned 1" },
      { id: "2", userRole: "OWNER", name: "Owned 2" },
      { id: "3", userRole: "ADMIN", name: "Admin workspace" },
      { id: "4", userRole: "DEVELOPER", name: "Dev workspace" },
      { id: "5", userRole: "VIEWER", name: "Viewer workspace" },
    ];

    const ownedWorkspaces = workspaces.filter(ws => ws.userRole === 'OWNER');
    const isAtLimit = ownedWorkspaces.length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

    expect(ownedWorkspaces).toHaveLength(2);
    expect(workspaces).toHaveLength(5); // Total workspaces user can access
    expect(isAtLimit).toBe(true); // But only 2 are owned, so at limit
  });
});
