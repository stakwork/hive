/**
 * Static in-memory test data factories.
 *
 * Note: This file contains static mock data builders for unit tests.
 * For Vitest mock configuration (e.g., mocking Prisma), see src/__tests__/mocks/
 */
import type { WorkspaceRole } from "@/lib/auth/roles";
import type { User, WorkspaceMember, Swarm, Workspace } from "@prisma/client";
import type { Session } from "next-auth";

export const mockData = {
  workspace(overrides: Record<string, unknown> = {}) {
    return {
      id: "ws-123",
      name: "Mock Workspace",
      description: "Mock description",
      slug: "mock-workspace",
      ownerId: "user-123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      userRole: "OWNER" as WorkspaceRole,
      memberCount: 1,
      ...overrides,
    };
  },

  workspaceResponse(overrides: Record<string, unknown> = {}) {
    return {
      id: "ws-123",
      name: "Mock Workspace",
      description: null,
      slug: "mock-workspace",
      ownerId: "user-123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      userRole: "OWNER" as WorkspaceRole,
      memberCount: 1,
      ...overrides,
    };
  },

  workspaces(count: number, overrides: Array<Partial<Workspace>> = []) {
    const roles: WorkspaceRole[] = [
      "OWNER",
      "ADMIN",
      "DEVELOPER",
      "PM",
      "STAKEHOLDER",
      "VIEWER",
    ];

    return Array.from({ length: count }, (_, index) => ({
      id: `ws-${index + 1}`,
      name: `Workspace ${index + 1}`,
      description: null,
      slug: `workspace-${index + 1}`,
      ownerId: index === 0 ? "user-123" : `user-${index + 1}`,
      createdAt: `2024-01-0${index + 1}T00:00:00.000Z`,
      updatedAt: `2024-01-0${index + 1}T00:00:00.000Z`,
      userRole: roles[index % roles.length],
      memberCount: index + 2,
      ...((overrides[index] as Record<string, unknown> | undefined) || {}),
    }));
  },

  user(overrides: Partial<User> = {}) {
    return {
      id: "user-123",
      name: "Mock User",
      email: "mock@example.com",
      role: "USER",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    };
  },

  workspaceMember(overrides: Partial<WorkspaceMember> = {}) {
    return {
      id: "member-123",
      workspaceId: "ws-123",
      userId: "user-123",
      role: "DEVELOPER" as WorkspaceRole,
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      ...overrides,
    };
  },

  swarm(overrides: Partial<Swarm> = {}) {
    return {
      id: "swarm-123",
      name: "mock-swarm",
      status: "ACTIVE",
      instanceType: "XL",
      workspaceId: "ws-123",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    };
  },

  session(userId: string, overrides: Partial<Session["user"]> = {}): Session {
    return {
      user: {
        id: userId,
        name: "Test User",
        email: "test@example.com",
        image: null,
        ...overrides,
      },
      expires: "2024-12-31T00:00:00.000Z",
    };
  },
};
