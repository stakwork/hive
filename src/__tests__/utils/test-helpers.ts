import { db } from "@/lib/db";
import type { User, Workspace, WorkspaceMember } from "@prisma/client";
import type { WorkspaceRole } from "@/lib/auth/roles";

// Test data factories for creating consistent test data

export interface CreateTestUserOptions {
  name?: string;
  email?: string;
  role?: "USER" | "ADMIN";
}

export interface CreateTestWorkspaceOptions {
  name?: string;
  description?: string;
  slug?: string;
  ownerId: string;
  stakworkApiKey?: string;
}

export interface CreateTestMembershipOptions {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
  leftAt?: Date;
}

export interface CreateTestSwarmOptions {
  name?: string;
  workspaceId: string;
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
  instanceType?: string;
}

/**
 * Creates a test user with consistent default data
 */
export async function createTestUser(
  options: CreateTestUserOptions = {}
): Promise<User> {
  const timestamp = Date.now();
  return db.user.create({
    data: {
      name: options.name || `Test User ${timestamp}`,
      email: options.email || `test-${timestamp}@example.com`,
      role: options.role || "USER",
    },
  });
}

/**
 * Creates multiple test users
 */
export async function createTestUsers(count: number): Promise<User[]> {
  const users: User[] = [];
  for (let i = 0; i < count; i++) {
    const user = await createTestUser({
      name: `Test User ${i + 1}`,
      email: `test-user-${i + 1}@example.com`,
    });
    users.push(user);
  }
  return users;
}

/**
 * Creates a test workspace with consistent default data
 */
export async function createTestWorkspace(
  options: CreateTestWorkspaceOptions
): Promise<Workspace> {
  const timestamp = Date.now();
  return db.workspace.create({
    data: {
      name: options.name || `Test Workspace ${timestamp}`,
      description: options.description || null,
      slug: options.slug || `test-workspace-${timestamp}`,
      ownerId: options.ownerId,
      stakworkApiKey: options.stakworkApiKey || null,
    },
  });
}

/**
 * Creates a workspace membership
 */
export async function createTestMembership(
  options: CreateTestMembershipOptions
): Promise<WorkspaceMember> {
  return db.workspaceMember.create({
    data: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      role: options.role || "VIEWER",
      leftAt: options.leftAt || null,
    },
  });
}

/**
 * Creates a test swarm
 */
export async function createTestSwarm(options: CreateTestSwarmOptions) {
  const timestamp = Date.now();
  return db.swarm.create({
    data: {
      name: options.name || `test-swarm-${timestamp}`,
      workspaceId: options.workspaceId,
      status: options.status || "ACTIVE",
      instanceType: options.instanceType || "XL",
    },
  });
}

/**
 * Creates a complete workspace setup with owner, members, and optionally a swarm
 */
export async function createCompleteWorkspaceSetup(options: {
  workspaceName?: string;
  workspaceSlug?: string;
  ownerName?: string;
  memberCount?: number;
  withSwarm?: boolean;
  swarmStatus?: "PENDING" | "ACTIVE" | "FAILED" | "DELETED";
}) {
  const {
    workspaceName,
    workspaceSlug,
    ownerName,
    memberCount = 2,
    withSwarm = false,
    swarmStatus = "ACTIVE",
  } = options;

  // Create owner
  const owner = await createTestUser({
    name: ownerName || "Workspace Owner",
  });

  // Create workspace
  const workspace = await createTestWorkspace({
    name: workspaceName,
    slug: workspaceSlug,
    ownerId: owner.id,
    stakworkApiKey: "test-api-key",
  });

  // Create members
  const members: User[] = [];
  const memberships: WorkspaceMember[] = [];
  const roles: WorkspaceRole[] = ["ADMIN", "PM", "DEVELOPER", "STAKEHOLDER", "VIEWER"];

  for (let i = 0; i < memberCount; i++) {
    const member = await createTestUser({
      name: `Member ${i + 1}`,
    });
    members.push(member);

    const membership = await createTestMembership({
      workspaceId: workspace.id,
      userId: member.id,
      role: roles[i % roles.length],
    });
    memberships.push(membership);
  }

  // Optionally create swarm
  let swarm = null;
  if (withSwarm) {
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      status: swarmStatus,
    });
  }

  return {
    owner,
    workspace,
    members,
    memberships,
    swarm,
  };
}

/**
 * Assertion helpers for testing workspace data
 */
export const workspaceAssertions = {
  /**
   * Asserts that a workspace response has the correct structure
   */
  hasCorrectStructure(workspace: unknown) {
    expect(workspace).toHaveProperty("id");
    expect(workspace).toHaveProperty("name");
    expect(workspace).toHaveProperty("slug");
    expect(workspace).toHaveProperty("ownerId");
    expect(workspace).toHaveProperty("createdAt");
    expect(workspace).toHaveProperty("updatedAt");
    expect(typeof workspace.createdAt).toBe("string");
    expect(typeof workspace.updatedAt).toBe("string");
  },

  /**
   * Asserts that a workspace with access has the correct structure
   */
  hasCorrectAccessStructure(workspace: unknown) {
    this.hasCorrectStructure(workspace);
    expect(workspace).toHaveProperty("userRole");
    expect(workspace).toHaveProperty("hasKey");
    expect(workspace).toHaveProperty("owner");
    expect(workspace).toHaveProperty("isCodeGraphSetup");
    expect(typeof workspace.hasKey).toBe("boolean");
    expect(typeof workspace.isCodeGraphSetup).toBe("boolean");
  },

  /**
   * Asserts that a workspace with role has the correct structure
   */
  hasCorrectRoleStructure(workspace: unknown) {
    this.hasCorrectStructure(workspace);
    expect(workspace).toHaveProperty("userRole");
    expect(workspace).toHaveProperty("memberCount");
    expect(typeof workspace.memberCount).toBe("number");
  },

  /**
   * Asserts that access validation has the correct structure
   */
  hasCorrectValidationStructure(validation: unknown) {
    expect(validation).toHaveProperty("hasAccess");
    expect(validation).toHaveProperty("canRead");
    expect(validation).toHaveProperty("canWrite");
    expect(validation).toHaveProperty("canAdmin");
    expect(typeof validation.hasAccess).toBe("boolean");
    expect(typeof validation.canRead).toBe("boolean");
    expect(typeof validation.canWrite).toBe("boolean");
    expect(typeof validation.canAdmin).toBe("boolean");
  },
};

/**
 * Mock data generators for unit tests
 */
export const mockData = {
  /**
   * Generates a mock workspace
   */
  workspace(overrides: Record<string, unknown> = {}) {
    return {
      id: "ws-123",
      name: "Mock Workspace",
      description: "Mock description",
      slug: "mock-workspace",
      ownerId: "user-123",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      stakworkApiKey: null,
      ...overrides,
    };
  },

  /**
   * Generates a mock user
   */
  user(overrides: Record<string, unknown> = {}) {
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

  /**
   * Generates a mock workspace member
   */
  workspaceMember(overrides: Record<string, unknown> = {}) {
    return {
      id: "member-123",
      workspaceId: "ws-123",
      userId: "user-123",
      role: "DEVELOPER",
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      ...overrides,
    };
  },

  /**
   * Generates a mock swarm
   */
  swarm(overrides: Record<string, unknown> = {}) {
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
};

/**
 * Database query helpers for testing
 */
export const dbHelpers = {
  /**
   * Counts total workspaces
   */
  async countWorkspaces(): Promise<number> {
    return db.workspace.count();
  },

  /**
   * Counts workspace members for a workspace
   */
  async countWorkspaceMembers(workspaceId: string): Promise<number> {
    return db.workspaceMember.count({
      where: { workspaceId, leftAt: null },
    });
  },

  /**
   * Gets workspace with all related data
   */
  async getWorkspaceWithRelations(workspaceId: string) {
    return db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        owner: true,
        members: {
          where: { leftAt: null },
          include: { user: true },
        },
        swarm: true,
        products: true,
      },
    });
  },

  /**
   * Checks if a workspace slug exists
   */
  async workspaceSlugExists(slug: string): Promise<boolean> {
    const workspace = await db.workspace.findUnique({
      where: { slug },
    });
    return !!workspace;
  },
};

/**
 * Test cleanup helpers
 */
export const cleanup = {
  /**
   * Deletes a workspace and all related data
   */
  async deleteWorkspace(workspaceId: string) {
    await db.workspace.delete({
      where: { id: workspaceId },
    });
  },

  /**
   * Deletes a user and all related data
   */
  async deleteUser(userId: string) {
    await db.user.delete({
      where: { id: userId },
    });
  },

  /**
   * Deletes multiple workspaces
   */
  async deleteWorkspaces(workspaceIds: string[]) {
    await db.workspace.deleteMany({
      where: { id: { in: workspaceIds } },
    });
  },

  /**
   * Deletes multiple users
   */
  async deleteUsers(userIds: string[]) {
    await db.user.deleteMany({
      where: { id: { in: userIds } },
    });
  },
};