import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { 
  createWorkspace,
  getWorkspacesByUserId,
  getWorkspaceBySlug,
  getUserWorkspaces,
  validateWorkspaceAccess,
  getDefaultWorkspaceForUser,
  deleteWorkspaceBySlug,
  validateWorkspaceSlug
} from "@/services/workspace";
import { db } from "@/lib/db";
import { 
  WORKSPACE_ERRORS
} from "@/lib/constants";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Workspace Service - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateWorkspaceSlug", () => {
    test("should accept valid slugs", () => {
      expect(validateWorkspaceSlug("my-workspace")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("workspace123")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("a1")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("test-workspace-123")).toEqual({ isValid: true });
    });

    test("should reject slugs that are too short", () => {
      expect(validateWorkspaceSlug("a")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH,
      });
    });

    test("should reject slugs that are too long", () => {
      const longSlug = "a".repeat(51);
      expect(validateWorkspaceSlug(longSlug)).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH,
      });
    });

    test("should reject invalid format slugs", () => {
      expect(validateWorkspaceSlug("-invalid")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
      expect(validateWorkspaceSlug("invalid-")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
      expect(validateWorkspaceSlug("invalid_underscore")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
      expect(validateWorkspaceSlug("Invalid-Caps")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
    });

    test("should reject reserved slugs", () => {
      expect(validateWorkspaceSlug("admin")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
      expect(validateWorkspaceSlug("api")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
      expect(validateWorkspaceSlug("dashboard")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
    });
  });

  describe("createWorkspace", () => {
    const mockWorkspaceData = {
      name: "Test Workspace",
      description: "A test workspace",
      slug: "test-workspace",
      ownerId: "user1",
    };

    test("should create workspace successfully", async () => {
      const mockCreatedWorkspace = {
        id: "ws1",
        ...mockWorkspaceData,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      (db.workspace.findUnique as Mock).mockResolvedValue(null);
      (db.workspace.create as Mock).mockResolvedValue(mockCreatedWorkspace);

      const result = await createWorkspace(mockWorkspaceData);

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-workspace", deleted: false },
      });
      expect(db.workspace.create).toHaveBeenCalledWith({
        data: mockWorkspaceData,
      });
      expect(result).toEqual({
        ...mockCreatedWorkspace,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });
    });

    test("should throw error for invalid slug", async () => {
      const invalidData = { ...mockWorkspaceData, slug: "invalid_slug" };

      await expect(createWorkspace(invalidData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("should throw error if slug already exists", async () => {
      const existingWorkspace = { id: "existing", slug: "test-workspace" };
      (db.workspace.findUnique as Mock).mockResolvedValue(existingWorkspace);

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("should handle Prisma unique constraint error", async () => {
      (db.workspace.findUnique as Mock).mockResolvedValue(null);
      (db.workspace.create as Mock).mockRejectedValue({
        code: "P2002",
        meta: { target: ["slug"] },
      });

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("should re-throw non-constraint errors", async () => {
      const error = new Error("Database connection failed");
      (db.workspace.findUnique as Mock).mockResolvedValue(null);
      (db.workspace.create as Mock).mockRejectedValue(error);

      await expect(createWorkspace(mockWorkspaceData)).rejects.toThrow(error);
    });
  });

  describe("getWorkspacesByUserId", () => {
    test("should return workspaces for user", async () => {
      const mockWorkspaces = [
        {
          id: "ws1",
          name: "Workspace 1",
          slug: "workspace-1",
          ownerId: "user1",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
        {
          id: "ws2",
          name: "Workspace 2",
          slug: "workspace-2",
          ownerId: "user1",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockWorkspaces);

      const result = await getWorkspacesByUserId("user1");

      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: { ownerId: "user1", deleted: false },
      });
      expect(result).toEqual([
        {
          ...mockWorkspaces[0],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          ...mockWorkspaces[1],
          createdAt: "2024-01-02T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ]);
    });

    test("should return empty array when no workspaces found", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);

      const result = await getWorkspacesByUserId("user1");

      expect(result).toEqual([]);
    });
  });

  describe("getWorkspaceBySlug", () => {
    const mockWorkspace = {
      id: "ws1",
      name: "Test Workspace",
      description: "A test workspace",
      slug: "test-workspace",
      ownerId: "owner1",
      stakworkApiKey: "api-key",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      owner: {
        id: "owner1",
        name: "Owner Name",
        email: "owner@example.com",
      },
      swarm: {
        id: "swarm1",
        status: "ACTIVE",
      },
    };

    test("should return workspace with owner access", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceBySlug("test-workspace", "owner1");

      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { slug: "test-workspace", deleted: false },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          swarm: { select: { id: true, status: true } },
        },
      });
      expect(result).toEqual({
        id: "ws1",
        name: "Test Workspace",
        description: "A test workspace",
        slug: "test-workspace",
        ownerId: "owner1",
        hasKey: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        userRole: "OWNER",
        owner: mockWorkspace.owner,
        isCodeGraphSetup: true,
      });
    });

    test("should return workspace with member access", async () => {
      const mockMembership = {
        role: "DEVELOPER",
      };

      (db.workspace.findFirst as Mock).mockResolvedValue({
        ...mockWorkspace,
        ownerId: "different-owner",
      });
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockMembership);

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
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const result = await getWorkspaceBySlug("non-existent", "user1");

      expect(result).toBeNull();
    });

    test("should return null for user without access", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue({
        ...mockWorkspace,
        ownerId: "different-owner",
      });
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

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

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock).mockResolvedValue(mockMemberships);
      (db.workspaceMember.count as Mock)
        .mockResolvedValueOnce(5) // For owned workspace
        .mockResolvedValueOnce(3); // For member workspace

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      expect(result[0].userRole).toBe("DEVELOPER"); // Member workspace comes first alphabetically
      expect(result[0].memberCount).toBe(4); // 3 + 1 for owner
      expect(result[1].userRole).toBe("OWNER");
      expect(result[1].memberCount).toBe(6); // 5 + 1 for owner
    });

    test("should handle empty results", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toEqual([]);
    });
  });

  describe("validateWorkspaceAccess", () => {
    test("should return access details for valid user", async () => {
      const mockWorkspace = {
        id: "ws1",
        name: "Test Workspace",
        description: "A test workspace",
        slug: "test-workspace",
        ownerId: "user1",
        userRole: "ADMIN" as const,
        hasKey: true,
        owner: { id: "user1", name: "Owner", email: "owner@example.com" },
        isCodeGraphSetup: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      // Mock database calls for getWorkspaceBySlug
      (db.workspace.findFirst as Mock).mockResolvedValue({
        ...mockWorkspace,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        owner: mockWorkspace.owner,
        swarm: { id: "swarm1", status: "ACTIVE" },
      });

      const result = await validateWorkspaceAccess("test-workspace", "user1");

      expect(result).toEqual({
        hasAccess: true,
        userRole: "OWNER", // user1 is the owner in this case
        workspace: {
          id: "ws1",
          name: "Test Workspace",
          description: "A test workspace",
          slug: "test-workspace",
          ownerId: "user1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });
    });

    test("should return no access for invalid user", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const result = await validateWorkspaceAccess("test-workspace", "user1");

      expect(result).toEqual({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });
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

      (db.workspace.findFirst as Mock).mockResolvedValue(mockOwnedWorkspace);

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

      (db.workspace.findFirst as Mock).mockResolvedValue(null);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockMembership);

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
      (db.workspace.findFirst as Mock).mockResolvedValue(null);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      const result = await getDefaultWorkspaceForUser("user1");

      expect(result).toBeNull();
    });
  });

  describe("deleteWorkspaceBySlug", () => {
    test("should delete workspace as owner", async () => {
      const mockWorkspace = {
        id: "ws1",
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: "user1",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        owner: { id: "user1", name: "Owner", email: "owner@example.com" },
        swarm: null,
      };

      // Mock database calls for getWorkspaceBySlug
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.workspace.update as Mock).mockResolvedValue({});

      await deleteWorkspaceBySlug("test-workspace", "user1");

      expect(db.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws1" },
        data: { 
          deleted: true,
          deletedAt: expect.any(Date)
        },
      });
    });

    test("should throw error if workspace not found", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      await expect(deleteWorkspaceBySlug("test-workspace", "user1"))
        .rejects.toThrow("Workspace not found or access denied");
    });

    test("should throw error if user is not owner", async () => {
      const mockWorkspace = {
        id: "ws1",
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: "different-user", // Different owner
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        owner: { id: "different-user", name: "Other Owner", email: "other@example.com" },
        swarm: null,
      };

      const mockMembership = {
        role: "ADMIN",
      };

      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockMembership);

      await expect(deleteWorkspaceBySlug("test-workspace", "user1"))
        .rejects.toThrow("Only workspace owners can delete workspaces");
    });
  });
});