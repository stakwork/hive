import { vi } from "vitest";
import type { WorkspaceRole } from "@/lib/auth/roles";

export const TEST_DATE = new Date("2024-01-01");
export const TEST_DATE_ISO = "2024-01-01T00:00:00.000Z";

export interface MockWorkspaceOptions {
  id?: string;
  name?: string;
  slug?: string;
  ownerId?: string;
  description?: string | null;
  stakworkApiKey?: string | null;
  deleted?: boolean;
  nodeTypeOrder?: Array<{ type: string; value: number }> | null;
  logoUrl?: string | null;
  logoKey?: string | null;
  repositoryDraft?: string | null;
  mission?: string | null;
  sourceControlOrgId?: string | null;
  originalSlug?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MockOwnerOptions {
  id?: string;
  name?: string;
  email?: string;
}

export interface MockSwarmOptions {
  id?: string;
  status?: string;
  ingestRefId?: string;
  poolState?: string;
  swarmUrl?: string | null;
}

export const workspaceMocks = {
  createMockWorkspace(overrides: MockWorkspaceOptions = {}) {
    return {
      id: overrides.id || "ws1",
      name: overrides.name || "Test Workspace",
      slug: overrides.slug || "test-workspace",
      ownerId: overrides.ownerId || "owner1",
      description: overrides.description === undefined ? "A test workspace" : overrides.description,
      stakworkApiKey: overrides.stakworkApiKey === undefined ? "api-key" : overrides.stakworkApiKey,
      deleted: overrides.deleted || false,
      deletedAt: null,
      nodeTypeOrder: overrides.nodeTypeOrder === undefined ? null : overrides.nodeTypeOrder,
      logoUrl: overrides.logoUrl === undefined ? null : overrides.logoUrl,
      logoKey: overrides.logoKey === undefined ? null : overrides.logoKey,
      repositoryDraft: overrides.repositoryDraft === undefined ? null : overrides.repositoryDraft,
      mission: overrides.mission === undefined ? null : overrides.mission,
      sourceControlOrgId: overrides.sourceControlOrgId === undefined ? null : overrides.sourceControlOrgId,
      originalSlug: overrides.originalSlug === undefined ? null : overrides.originalSlug,
      createdAt: overrides.createdAt || TEST_DATE,
      updatedAt: overrides.updatedAt || TEST_DATE,
    };
  },

  createMockOwner(overrides: MockOwnerOptions = {}) {
    return {
      id: overrides.id || "owner1",
      name: overrides.name || "Owner Name",
      email: overrides.email || "owner@example.com",
    };
  },

  createMockSwarm(overrides: MockSwarmOptions = {}) {
    return {
      id: overrides.id || "swarm1",
      status: overrides.status || "ACTIVE",
      ingestRefId: overrides.ingestRefId || "ingest-123",
      poolState: overrides.poolState || "STARTED",
      swarmUrl: overrides.swarmUrl === undefined ? null : overrides.swarmUrl,
    };
  },

  createMockWorkspaceWithRelations(
    workspaceOverrides: MockWorkspaceOptions = {},
    ownerOverrides: MockOwnerOptions = {},
    swarmOverrides: MockSwarmOptions | null = {},
  ) {
    const workspace = this.createMockWorkspace(workspaceOverrides);
    const owner = this.createMockOwner({ id: workspace.ownerId, ...ownerOverrides });
    const swarm = swarmOverrides === null ? null : this.createMockSwarm(swarmOverrides);

    return {
      ...workspace,
      owner,
      swarm,
      repositories: [],
    };
  },

  createMockMembership(role: WorkspaceRole = "DEVELOPER", overrides = {}) {
    return {
      id: "member1",
      workspaceId: "ws1",
      userId: "user1",
      role,
      joinedAt: TEST_DATE,
      leftAt: null,
      ...overrides,
    };
  },

  serializeDates<T extends { createdAt: Date | string; updatedAt: Date | string }>(obj: T) {
    return {
      ...obj,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : obj.createdAt.toISOString(),
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : obj.updatedAt.toISOString(),
    };
  },
};

export const workspaceMockSetup = {
  mockWorkspaceWithOwnerAccess(db: any, workspace: any) {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(workspace);
  },

  mockWorkspaceWithMemberAccess(db: any, workspace: any, role: WorkspaceRole = "DEVELOPER") {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      ...workspace,
      ownerId: "different-owner",
    });
    vi.mocked(db.workspaceMember.findFirst).mockResolvedValue({ role });
  },

  mockWorkspaceNotFound(db: any) {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);
  },

  mockWorkspaceCreate(db: any, workspace: any) {
    vi.mocked(db.workspace.count).mockResolvedValue(1);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(db.workspace.create).mockResolvedValue(workspace);
  },

  mockWorkspaceSlugExists(db: any, existingWorkspace: any) {
    vi.mocked(db.workspace.count).mockResolvedValue(1);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(existingWorkspace);
  },

  mockWorkspaceUpdate(db: any, updatedWorkspace: any) {
    vi.mocked(db.workspace.update).mockResolvedValue(updatedWorkspace);
  },

  mockWorkspaceUpdateScenario(db: any, originalWorkspace: any, updatedWorkspace: any, options: {
    memberRole?: WorkspaceRole;
    slugExists?: boolean;
  } = {}) {
    // Mock getWorkspaceBySlug
    vi.mocked(db.workspace.findFirst).mockResolvedValue(originalWorkspace);

    if (options.memberRole) {
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue({ role: options.memberRole });
    } else {
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
    }

    // Mock slug uniqueness check
    if (options.slugExists) {
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ id: "existing", slug: "existing-slug" });
    } else {
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    }

    // Mock update operation
    vi.mocked(db.workspace.update).mockResolvedValue(updatedWorkspace);
  },

  mockPrismaError(db: any, operation: "create" | "update", code: string = "P2002", target: string[] = ["slug"]) {
    const error = { code, meta: { target } };
    if (operation === "create") {
      vi.mocked(db.workspace.create).mockRejectedValue(error);
    } else {
      vi.mocked(db.workspace.update).mockRejectedValue(error);
    }
  },
};

export const memberMockSetup = {
  mockAddMemberSuccess(
    findUserByGitHubUsername: any,
    findActiveMember: any,
    findPreviousMember: any,
    isWorkspaceOwner: any,
    createWorkspaceMember: any,
    mockGitHubAuth: any,
    mockCreatedMember: any
  ) {
    vi.mocked(findUserByGitHubUsername).mockResolvedValue({
      ...mockGitHubAuth,
      user: {
        id: mockCreatedMember.userId,
        name: mockCreatedMember.user.name,
        email: mockCreatedMember.user.email,
        image: mockCreatedMember.user.image,
      },
    });
    vi.mocked(findActiveMember).mockResolvedValue(null);
    vi.mocked(findPreviousMember).mockResolvedValue(null);
    vi.mocked(isWorkspaceOwner).mockResolvedValue(false);
    vi.mocked(createWorkspaceMember).mockResolvedValue(mockCreatedMember);
  },

  mockReactivateMember(
    findUserByGitHubUsername: any,
    findActiveMember: any,
    findPreviousMember: any,
    isWorkspaceOwner: any,
    reactivateWorkspaceMember: any,
    mockGitHubAuth: any,
    previousMember: any,
    reactivatedMember: any
  ) {
    vi.mocked(findUserByGitHubUsername).mockResolvedValue({
      ...mockGitHubAuth,
      user: reactivatedMember.user,
    });
    vi.mocked(findActiveMember).mockResolvedValue(null);
    vi.mocked(findPreviousMember).mockResolvedValue(previousMember);
    vi.mocked(isWorkspaceOwner).mockResolvedValue(false);
    vi.mocked(reactivateWorkspaceMember).mockResolvedValue(reactivatedMember);
  },

  mockUpdateMemberRole(
    findActiveMember: any,
    updateMemberRole: any,
    mockMember: any,
    updatedMember: any
  ) {
    vi.mocked(findActiveMember).mockResolvedValue(mockMember);
    vi.mocked(updateMemberRole).mockResolvedValue(updatedMember);
  },

  mockRemoveMember(
    findActiveMember: any,
    softDeleteMember: any,
    mockMember: any
  ) {
    vi.mocked(findActiveMember).mockResolvedValue(mockMember);
    vi.mocked(softDeleteMember).mockResolvedValue(undefined);
  },
};