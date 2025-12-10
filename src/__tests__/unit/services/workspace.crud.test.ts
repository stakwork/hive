import { TEST_DATE_ISO, workspaceMocks, workspaceMockSetup } from "@/__tests__/support/helpers/service-mocks/workspace-mocks";
import { WORKSPACE_ERRORS, WORKSPACE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  createWorkspace,
  deleteWorkspaceBySlug,
  getDefaultWorkspaceForUser,
  getUserWorkspaces,
  getWorkspaceBySlug,
  getWorkspacesByUserId,
  updateWorkspace
} from "@/services/workspace";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockedDb = vi.mocked(db);

describe("Workspace CRUD Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWorkspace", () => {
    const mockWorkspaceData = {
      name: "Test Workspace",
      description: "A test workspace",
      slug: "test-workspace",
      ownerId: "user1",
    };

    test("should create workspace successfully", async () => {
      const mockCreatedWorkspace = workspaceMocks.createMockWorkspace({
        id: "ws1",
        ...mockWorkspaceData,
      });

      workspaceMockSetup.mockWorkspaceCreate(mockedDb, mockCreatedWorkspace);

      const result = await createWorkspace(mockWorkspaceData);

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: "user1", deleted: false },
      });
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-workspace", deleted: false },
        select: { id: true },
      });
      expect(db.workspace.create).toHaveBeenCalledWith({
        data: mockWorkspaceData,
      });
      expect(result).toEqual(workspaceMocks.serializeDates(mockCreatedWorkspace));
    });

    test("should throw error when workspace limit exceeded", async () => {
      mockedDb.workspace.count.mockResolvedValue(WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER);

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: "user1", deleted: false },
      });
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("should throw error for invalid slug", async () => {
      const invalidData = { ...mockWorkspaceData, slug: "invalid_slug" };

      await expect(createWorkspace(invalidData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("should throw error if slug already exists", async () => {
      const existingWorkspace = workspaceMocks.createMockWorkspace({ id: "existing" });
      workspaceMockSetup.mockWorkspaceSlugExists(mockedDb, existingWorkspace);

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("should handle Prisma unique constraint error", async () => {
      mockedDb.workspace.count.mockResolvedValue(1);
      mockedDb.workspace.findUnique.mockResolvedValue(null);
      workspaceMockSetup.mockPrismaError(mockedDb, "create");

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("should re-throw non-constraint errors", async () => {
      const error = new Error("Database connection failed");
      mockedDb.workspace.count.mockResolvedValue(1);
      mockedDb.workspace.findUnique.mockResolvedValue(null);
      mockedDb.workspace.create.mockRejectedValue(error);

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(error);
    });
  });

  describe("getWorkspacesByUserId", () => {
    test("should return workspaces for user", async () => {
      const mockWorkspaces = [
        workspaceMocks.createMockWorkspace({
          id: "ws1",
          name: "Workspace 1",
          slug: "workspace-1",
          ownerId: "user1",
        }),
        workspaceMocks.createMockWorkspace({
          id: "ws2",
          name: "Workspace 2",
          slug: "workspace-2",
          ownerId: "user1",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        }),
      ];

      mockedDb.workspace.findMany.mockResolvedValue(mockWorkspaces);

      const result = await getWorkspacesByUserId("user1");

      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: { ownerId: "user1", deleted: false },
      });
      expect(result).toEqual([
        workspaceMocks.serializeDates(mockWorkspaces[0]),
        workspaceMocks.serializeDates(mockWorkspaces[1]),
      ]);
    });

    test("should return empty array when no workspaces found", async () => {
      mockedDb.workspace.findMany.mockResolvedValue([]);

      const result = await getWorkspacesByUserId("user1");

      expect(result).toEqual([]);
    });
  });

  describe("getWorkspaceBySlug", () => {
    const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations();

    test("should return workspace with owner access", async () => {
      workspaceMockSetup.mockWorkspaceWithOwnerAccess(mockedDb, mockWorkspace);

      const result = await getWorkspaceBySlug("test-workspace", "owner1");

      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { slug: "test-workspace", deleted: false },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          swarm: { select: { id: true, status: true, ingestRefId: true, poolState: true, containerFilesSetUp: true, swarmUrl: true } },
          repositories: { select: { id: true, name: true, repositoryUrl: true, branch: true, status: true, updatedAt: true } },
        },
      });
      expect(result).toEqual({
        id: "ws1",
        name: "Test Workspace",
        description: "A test workspace",
        containerFilesSetUp: null,
        repositoryDraft: null,
        swarmId: "swarm1",
        slug: "test-workspace",
        ownerId: "owner1",
        hasKey: true,
        createdAt: TEST_DATE_ISO,
        updatedAt: TEST_DATE_ISO,
        userRole: "OWNER",
        owner: mockWorkspace.owner,
        isCodeGraphSetup: true,
        swarmStatus: "ACTIVE",
        swarmUrl: null,
        ingestRefId: "ingest-123",
        poolState: "STARTED",
        logoKey: null,
        logoUrl: null,
        nodeTypeOrder: null,
        repositories: [],
      });
    });

    test("should return workspace with member access", async () => {
      workspaceMockSetup.mockWorkspaceWithMemberAccess(mockedDb, mockWorkspace, "DEVELOPER");

      const result = await getWorkspaceBySlug("test-workspace", "user1");

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: "ws1",
          userId: "user1",
          leftAt: null,
        },
      });
      expect(result?.userRole).toBe("DEVELOPER");
    });

    test("should return null for non-existent workspace", async () => {
      workspaceMockSetup.mockWorkspaceNotFound(mockedDb);

      const result = await getWorkspaceBySlug("non-existent", "user1");

      expect(result).toBeNull();
    });

    test("should return null for user without access", async () => {
      workspaceMockSetup.mockWorkspaceWithMemberAccess(mockedDb, mockWorkspace, "DEVELOPER");
      mockedDb.workspaceMember.findFirst.mockResolvedValue(null);

      const result = await getWorkspaceBySlug("test-workspace", "user1");

      expect(result).toBeNull();
    });
  });

  describe("getUserWorkspaces", () => {
    test("should return owned and member workspaces", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Owned Workspace",
          slug: "owned-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws2",
            name: "Member Workspace",
            slug: "member-workspace",
            ownerId: "other-user",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
          },
        },
      ];

      mockedDb.workspace.findMany.mockResolvedValue(mockOwnedWorkspaces);
      mockedDb.workspaceMember.findMany
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([
          { workspaceId: "ws1" }, { workspaceId: "ws1" }, { workspaceId: "ws1" }, { workspaceId: "ws1" }, { workspaceId: "ws1" },
          { workspaceId: "ws2" }, { workspaceId: "ws2" }, { workspaceId: "ws2" }
        ]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      expect(result[0].userRole).toBe("DEVELOPER");
      expect(result[0].memberCount).toBe(4);
      expect(result[1].userRole).toBe("OWNER");
      expect(result[1].memberCount).toBe(6);
    });

    test("should handle empty results", async () => {
      mockedDb.workspace.findMany.mockResolvedValue([]);
      mockedDb.workspaceMember.findMany.mockResolvedValue([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toEqual([]);
    });
  });

  describe("getDefaultWorkspaceForUser", () => {
    test("should return first owned workspace", async () => {
      const mockOwnedWorkspace = {
        id: "ws1",
        name: "Owned Workspace",
        slug: "owned-workspace",
        ownerId: "user1",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockedDb.workspace.findFirst.mockResolvedValue(mockOwnedWorkspace);

      const result = await getDefaultWorkspaceForUser("user1");

      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: "user1", deleted: false },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual({
        ...mockOwnedWorkspace,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });
    });

    test("should return first member workspace if no owned", async () => {
      const mockMembership = {
        workspace: {
          id: "ws2",
          name: "Member Workspace",
          slug: "member-workspace",
          ownerId: "other-user",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
      };

      mockedDb.workspace.findFirst.mockResolvedValue(null);
      mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

      const result = await getDefaultWorkspaceForUser("user1");

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: { userId: "user1", leftAt: null },
        include: { workspace: true },
        orderBy: { joinedAt: "asc" },
      });
      expect(result).toEqual({
        ...mockMembership.workspace,
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      });
    });

    test("should return null if no workspaces found", async () => {
      mockedDb.workspace.findFirst.mockResolvedValue(null);
      mockedDb.workspaceMember.findFirst.mockResolvedValue(null);

      const result = await getDefaultWorkspaceForUser("user1");

      expect(result).toBeNull();
    });
  });

  describe("deleteWorkspaceBySlug", () => {
    test("should delete workspace as owner", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { ownerId: "user1" },
        { id: "user1", name: "Owner", email: "owner@example.com" },
        null
      );

      workspaceMockSetup.mockWorkspaceWithOwnerAccess(mockedDb, mockWorkspace);
      mockedDb.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockedDb.workspace.update.mockResolvedValue({});
      mockedDb.swarm.findFirst.mockResolvedValue(null);

      await deleteWorkspaceBySlug("test-workspace", "user1");

      expect(db.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws1" },
        data: {
          deleted: true,
          deletedAt: expect.any(Date),
          originalSlug: "test-workspace",
          slug: expect.stringMatching(/^test-workspace-deleted-\d+$/)
        },
      });
    });

    test("should throw error if workspace not found", async () => {
      workspaceMockSetup.mockWorkspaceNotFound(mockedDb);

      await expect(deleteWorkspaceBySlug("test-workspace", "user1"))
        .rejects.toThrow("Workspace not found or access denied");
    });

    test("should throw error if user is not owner", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { ownerId: "different-user" },
        { id: "different-user", name: "Other Owner", email: "other@example.com" },
        null
      );

      workspaceMockSetup.mockWorkspaceWithMemberAccess(mockedDb, mockWorkspace, "ADMIN");

      await expect(deleteWorkspaceBySlug("test-workspace", "user1"))
        .rejects.toThrow("Only workspace owners can delete workspaces");
    });
  });

  describe("updateWorkspace", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test("should update workspace successfully", async () => {
      const originalWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        {
          id: "workspace1",
          name: "Original Workspace",
          slug: "original-workspace",
          description: "Original description",
          ownerId: "user1",
          createdAt: new Date("2023-01-01T00:00:00.000Z"),
          updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        },
        { id: "user1", name: "User", email: "user@example.com" },
        null
      );

      const updatedWorkspace = workspaceMocks.createMockWorkspace({
        id: "workspace1",
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
        ownerId: "user1",
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-02T00:00:00.000Z"),
      });

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      workspaceMockSetup.mockWorkspaceUpdateScenario(mockedDb, originalWorkspace, updatedWorkspace);

      const result = await updateWorkspace("original-workspace", "user1", updateData);

      expect(result).toEqual({
        id: "workspace1",
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
        deleted: false,
        deletedAt: null,
        ownerId: "user1",
        stakworkApiKey: "api-key",
        nodeTypeOrder: null,
        logoUrl: null,
        logoKey: null,
        repositoryDraft: null,
        mission: null,
        sourceControlOrgId: null,
        originalSlug: null,
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-02T00:00:00.000Z",
      });

      expect(db.workspace.update).toHaveBeenCalledWith({
        where: { id: "workspace1" },
        data: {
          name: "Updated Workspace",
          slug: "updated-workspace",
          description: "Updated description",
          updatedAt: expect.any(Date),
        },
      });
    });

    test("should throw error if workspace not found", async () => {
      workspaceMockSetup.mockWorkspaceNotFound(mockedDb);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      await expect(updateWorkspace("nonexistent", "user1", updateData)).rejects.toThrow("Workspace not found or access denied");
    });

    test("should throw error if user is not OWNER or ADMIN", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { ownerId: "owner1" },
        { id: "owner1", name: "Owner", email: "owner@example.com" },
        null
      );

      workspaceMockSetup.mockWorkspaceUpdateScenario(mockedDb, mockWorkspace, mockWorkspace, {
        memberRole: "DEVELOPER"
      });

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      await expect(updateWorkspace("test-workspace", "user1", updateData)).rejects.toThrow("Only workspace owners and admins can update workspace settings");
    });

    test("should validate new slug if slug is changing", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { slug: "original-slug", ownerId: "user1" },
        { id: "user1", name: "User", email: "user@example.com" },
        null
      );

      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);

      const updateData = {
        name: "Test Workspace",
        slug: "api",
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_RESERVED);
    });

    test("should throw error if new slug already exists", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { slug: "original-slug", ownerId: "user1" },
        { id: "user1", name: "User", email: "user@example.com" },
        null
      );

      workspaceMockSetup.mockWorkspaceUpdateScenario(mockedDb, mockWorkspace, mockWorkspace, {
        slugExists: true
      });

      const updateData = {
        name: "Test Workspace",
        slug: "existing-slug",
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });

    test("should allow updating same slug (no change)", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        {
          slug: "test-slug",
          description: "Original description",
          ownerId: "user1",
        },
        { id: "user1", name: "User", email: "user@example.com" },
        null
      );

      const updatedWorkspace = workspaceMocks.createMockWorkspace({
        ...mockWorkspace,
        description: "Updated description",
        updatedAt: new Date("2023-01-02T00:00:00.000Z"),
      });

      workspaceMockSetup.mockWorkspaceUpdateScenario(mockedDb, mockWorkspace, updatedWorkspace);

      const updateData = {
        name: "Test Workspace",
        slug: "test-slug",
        description: "Updated description",
      };

      const result = await updateWorkspace("test-slug", "user1", updateData);

      expect(result.description).toBe("Updated description");
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("should handle Prisma unique constraint error", async () => {
      const mockWorkspace = workspaceMocks.createMockWorkspaceWithRelations(
        { slug: "original-slug", ownerId: "user1" },
        { id: "user1", name: "User", email: "user@example.com" },
        null
      );

      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      workspaceMockSetup.mockPrismaError(mockedDb, "update");

      const updateData = {
        name: "Test Workspace",
        slug: "new-slug",
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });
  });
});