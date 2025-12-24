import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateWorkspaceAccess, validateWorkspaceAccessById } from "@/services/workspace";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("Workspace Authorization with allowOwner Parameter", () => {
  const mockUserId = "user-123";
  const mockOwnerId = "owner-456";
  const mockWorkspaceId = "workspace-789";
  const mockWorkspaceSlug = "test-workspace";

  const mockWorkspace = {
    id: mockWorkspaceId,
    name: "Test Workspace",
    description: "Test Description",
    slug: mockWorkspaceSlug,
    ownerId: mockOwnerId,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    deleted: false,
    deletedAt: null,
    originalSlug: null,
    sourceControlOrgId: null,
    stakworkApiKey: null,
    repositoryDraft: null,
    logoUrl: null,
    logoKey: null,
    mission: null,
    nodeTypeOrder: [],
    owner: {
      id: mockOwnerId,
      name: "Owner User",
      email: "owner@example.com",
    },
    swarm: null,
    repositories: [],
  };

  // Helper to create a membership mock
  const createMembershipMock = (role: WorkspaceRole, userId: string = mockOwnerId) => ({
    id: "member-1",
    workspaceId: mockWorkspaceId,
    userId,
    role,
    joinedAt: new Date(),
    leftAt: null,
    lastAccessedAt: null,
  });

  // Helper to assert full permissions (owner/admin)
  const expectFullPermissions = (result: any) => {
    expect(result.hasAccess).toBe(true);
    expect(result.canRead).toBe(true);
    expect(result.canWrite).toBe(true);
    expect(result.canAdmin).toBe(true);
  };

  // Helper to assert read-only permissions (viewer/stakeholder)
  const expectReadOnlyPermissions = (result: any) => {
    expect(result.hasAccess).toBe(true);
    expect(result.canRead).toBe(true);
    expect(result.canWrite).toBe(false);
    expect(result.canAdmin).toBe(false);
  };

  // Helper to assert write permissions (developer/PM)
  const expectWritePermissions = (result: any) => {
    expect(result.hasAccess).toBe(true);
    expect(result.canRead).toBe(true);
    expect(result.canWrite).toBe(true);
    expect(result.canAdmin).toBe(false);
  };

  // Helper to assert no access
  const expectNoAccess = (result: any) => {
    expect(result.hasAccess).toBe(false);
    expect(result.canRead).toBe(false);
    expect(result.canWrite).toBe(false);
    expect(result.canAdmin).toBe(false);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateWorkspaceAccess", () => {
    describe("when allowOwner is true (default behavior)", () => {
      it("should allow owner to bypass role restrictions", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId, true);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe("OWNER");
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(true);
        expect(db.workspaceMember.findUnique).not.toHaveBeenCalled();
      });

      it("should allow owner to bypass role restrictions when parameter is omitted", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe("OWNER");
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(true);
      });
    });

    describe("when allowOwner is false", () => {
      it("should deny access when owner has no membership role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId, false);

        expectNoAccess(result);
        expect(db.workspaceMember.findUnique).toHaveBeenCalledWith({
          where: {
            workspaceId_userId: {
              workspaceId: mockWorkspaceId,
              userId: mockOwnerId,
            },
          },
          select: {
            role: true,
          },
        });
      });

      it("should use membership role when owner has VIEWER role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.VIEWER));

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.VIEWER);
        expectReadOnlyPermissions(result);
      });

      it("should use membership role when owner has DEVELOPER role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.DEVELOPER));

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.DEVELOPER);
        expectWritePermissions(result);
      });

      it("should use membership role when owner has ADMIN role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.ADMIN));

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.ADMIN);
        expectFullPermissions(result);
      });

      it("should not affect non-owner users", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue({
          id: "member-1",
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          role: WorkspaceRole.PM,
          joinedAt: new Date(),
          leftAt: null,
          lastAccessedAt: null,
          workspace: mockWorkspace,
          user: {
            id: mockUserId,
            name: "Member User",
            email: "member@example.com",
            emailVerified: null,
            image: null,
            role: "USER" as const,
            timezone: "UTC",
            locale: "en",
            createdAt: new Date(),
            updatedAt: new Date(),
            deleted: false,
            deletedAt: null,
            lastLoginAt: null,
            poolApiKey: null,
          },
        });

        const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockUserId, false);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe(WorkspaceRole.PM);
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(false);
        expect(db.workspaceMember.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe("validateWorkspaceAccessById", () => {
    describe("when allowOwner is true (default behavior)", () => {
      it("should allow owner to bypass role restrictions", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId, true);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe("OWNER");
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(true);
        expect(db.workspaceMember.findUnique).not.toHaveBeenCalled();
      });

      it("should allow owner to bypass role restrictions when parameter is omitted", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe("OWNER");
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(true);
      });
    });

    describe("when allowOwner is false", () => {
      it("should deny access when owner has no membership role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId, false);

        expectNoAccess(result);
        expect(db.workspaceMember.findUnique).toHaveBeenCalledWith({
          where: {
            workspaceId_userId: {
              workspaceId: mockWorkspaceId,
              userId: mockOwnerId,
            },
          },
          select: {
            role: true,
          },
        });
      });

      it("should use membership role when owner has VIEWER role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.VIEWER));

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.VIEWER);
        expectReadOnlyPermissions(result);
      });

      it("should use membership role when owner has DEVELOPER role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.DEVELOPER));

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.DEVELOPER);
        expectWritePermissions(result);
      });

      it("should use membership role when owner has ADMIN role", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
        vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(createMembershipMock(WorkspaceRole.ADMIN));

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockOwnerId, false);

        expect(result.userRole).toBe(WorkspaceRole.ADMIN);
        expectFullPermissions(result);
      });

      it("should not affect non-owner users", async () => {
        vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
        vi.mocked(db.workspaceMember.findFirst).mockResolvedValue({
          id: "member-1",
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          role: WorkspaceRole.PM,
          joinedAt: new Date(),
          leftAt: null,
          lastAccessedAt: null,
          workspace: mockWorkspace,
          user: {
            id: mockUserId,
            name: "Member User",
            email: "member@example.com",
            emailVerified: null,
            image: null,
            role: "USER" as const,
            timezone: "UTC",
            locale: "en",
            createdAt: new Date(),
            updatedAt: new Date(),
            deleted: false,
            deletedAt: null,
            lastLoginAt: null,
            poolApiKey: null,
          },
        });

        const result = await validateWorkspaceAccessById(mockWorkspaceId, mockUserId, false);

        expect(result.hasAccess).toBe(true);
        expect(result.userRole).toBe(WorkspaceRole.PM);
        expect(result.canRead).toBe(true);
        expect(result.canWrite).toBe(true);
        expect(result.canAdmin).toBe(false);
        expect(db.workspaceMember.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle workspace not found", async () => {
      vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

      const result = await validateWorkspaceAccess(mockWorkspaceSlug, mockUserId, false);

      expectNoAccess(result);
    });

    it("should handle workspace not found by ID", async () => {
      vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

      const result = await validateWorkspaceAccessById(mockWorkspaceId, mockUserId, false);

      expectNoAccess(result);
    });
  });
});
