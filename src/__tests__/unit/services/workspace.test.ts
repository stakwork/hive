import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { 
  createWorkspace,
  getWorkspacesByUserId,
  getWorkspaceBySlug,
  getUserWorkspaces,
  validateWorkspaceAccess,
  getDefaultWorkspaceForUser,
  deleteWorkspaceBySlug,
  validateWorkspaceSlug,
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  updateWorkspace
} from "@/services/workspace";
import { db } from "@/lib/db";
import { 
  WORKSPACE_ERRORS
} from "@/lib/constants";
import {
  findUserByGitHubUsername,
  findActiveMember,
  findPreviousMember,
  isWorkspaceOwner,
  createWorkspaceMember,
  reactivateWorkspaceMember,
  getActiveWorkspaceMembers,
  updateMemberRole,
  softDeleteMember,
} from "@/lib/helpers/workspace-member-queries";
import { mapWorkspaceMember, mapWorkspaceMembers } from "@/lib/mappers/workspace-member";

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
      create: vi.fn(),
      update: vi.fn(),
    },
    gitHubAuth: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the helper functions
vi.mock("@/lib/helpers/workspace-member-queries", () => ({
  findUserByGitHubUsername: vi.fn(),
  findActiveMember: vi.fn(),
  findPreviousMember: vi.fn(),
  isWorkspaceOwner: vi.fn(),
  createWorkspaceMember: vi.fn(),
  reactivateWorkspaceMember: vi.fn(),
  getActiveWorkspaceMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  softDeleteMember: vi.fn(),
}));

// Mock the mapper functions
vi.mock("@/lib/mappers/workspace-member", () => ({
  mapWorkspaceMember: vi.fn((member) => member),
  mapWorkspaceMembers: vi.fn((members) => members),
  WORKSPACE_MEMBER_INCLUDE: {},
}));

const mockedFindUserByGitHubUsername = vi.mocked(findUserByGitHubUsername);
const mockedFindActiveMember = vi.mocked(findActiveMember);
const mockedFindPreviousMember = vi.mocked(findPreviousMember);
const mockedIsWorkspaceOwner = vi.mocked(isWorkspaceOwner);
const mockedCreateWorkspaceMember = vi.mocked(createWorkspaceMember);
const mockedReactivateWorkspaceMember = vi.mocked(reactivateWorkspaceMember);
const mockedGetActiveWorkspaceMembers = vi.mocked(getActiveWorkspaceMembers);
const mockedUpdateMemberRole = vi.mocked(updateMemberRole);
const mockedSoftDeleteMember = vi.mocked(softDeleteMember);
const mockedMapWorkspaceMember = vi.mocked(mapWorkspaceMember);
const mockedMapWorkspaceMembers = vi.mocked(mapWorkspaceMembers);

describe("Workspace Service - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
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

  describe("Workspace Member Management", () => {
    describe("getWorkspaceMembers", () => {
      test("should return workspace members with user and GitHub data", async () => {
        const mockMembers = [
          {
            id: "member1",
            userId: "user1",
            role: "DEVELOPER",
            joinedAt: new Date("2024-01-01"),
            user: {
              id: "user1",
              name: "John Doe",
              email: "john@example.com",
              image: "https://github.com/john.png",
              githubAuth: {
                githubUsername: "johndoe",
                name: "John Doe",
                bio: "Software Developer",
                publicRepos: 25,
                followers: 100,
              },
            },
          },
          {
            id: "member2",
            userId: "user2",
            role: "PM",
            joinedAt: new Date("2024-01-02"),
            user: {
              id: "user2",
              name: "Jane Smith",
              email: "jane@example.com",
              image: "https://github.com/jane.png",
              githubAuth: {
                githubUsername: "janesmith",
                name: "Jane Smith",
                bio: "Product Manager",
                publicRepos: 15,
                followers: 50,
              },
            },
          },
        ];

        const mockWorkspace = {
          id: "workspace1",
          createdAt: new Date("2024-01-01"),
          owner: {
            id: "owner1",
            name: "Workspace Owner",
            email: "owner@example.com",
            image: "https://github.com/owner.png",
            githubAuth: {
              githubUsername: "workspaceowner",
              name: "Workspace Owner",
              bio: "Team Lead",
              publicRepos: 30,
              followers: 200,
            },
          },
        };

        mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
        mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
        (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

        const result = await getWorkspaceMembers("workspace1");

        expect(mockedGetActiveWorkspaceMembers).toHaveBeenCalledWith("workspace1");
        expect(mockedMapWorkspaceMembers).toHaveBeenCalledWith(mockMembers);
        expect(result).toEqual({
          members: mockMembers,
          owner: {
            id: "owner1",
            userId: "owner1",
            role: "OWNER",
            joinedAt: "2024-01-01T00:00:00.000Z",
            user: {
              id: "owner1",
              name: "Workspace Owner",
              email: "owner@example.com",
              image: "https://github.com/owner.png",
              github: {
                username: "workspaceowner",
                name: "Workspace Owner",
                bio: "Team Lead",
                publicRepos: 30,
                followers: 200,
              },
            },
          },
        });
      });

      test("should handle members without GitHub auth", async () => {
        const mockMembers = [
          {
            id: "member1",
            userId: "user1",
            role: "VIEWER",
            joinedAt: new Date("2024-01-01"),
            user: {
              id: "user1",
              name: "John Doe",
              email: "john@example.com",
              image: null,
              githubAuth: null,
            },
          },
        ];

        const mockWorkspace = {
          id: "workspace1",
          createdAt: new Date("2024-01-01"),
          owner: {
            id: "owner1",
            name: "Workspace Owner",
            email: "owner@example.com",
            image: null,
            githubAuth: null,
          },
        };

        mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
        mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
        (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

        const result = await getWorkspaceMembers("workspace1");

        expect(result).toEqual({
          members: mockMembers,
          owner: {
            id: "owner1",
            userId: "owner1",
            role: "OWNER",
            joinedAt: "2024-01-01T00:00:00.000Z",
            user: {
              id: "owner1",
              name: "Workspace Owner",
              email: "owner@example.com",
              image: null,
              github: null,
            },
          },
        });
      });
    });

    describe("addWorkspaceMember", () => {
      const mockGitHubAuth = {
        userId: "user1",
        githubUsername: "johndoe",
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/john.png",
        },
      };

      const mockCreatedMember = {
        id: "member1",
        userId: "user1",
        role: "DEVELOPER",
        joinedAt: new Date("2024-01-01"),
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/john.png",
          githubAuth: {
            githubUsername: "johndoe",
            name: "John Doe",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      };

      test("should add workspace member successfully", async () => {
        mockedFindUserByGitHubUsername.mockResolvedValue(mockGitHubAuth);
        mockedFindActiveMember.mockResolvedValue(null);
        mockedFindPreviousMember.mockResolvedValue(null);
        mockedIsWorkspaceOwner.mockResolvedValue(false);
        mockedCreateWorkspaceMember.mockResolvedValue(mockCreatedMember);
        mockedMapWorkspaceMember.mockReturnValue({
          id: "member1",
          userId: "user1",
          role: "DEVELOPER",
          joinedAt: "2024-01-01T00:00:00.000Z",
          user: {
            id: "user1",
            name: "John Doe",
            email: "john@example.com",
            image: "https://github.com/john.png",
            github: {
              username: "johndoe",
              name: "John Doe",
              bio: "Software Developer",
              publicRepos: 25,
              followers: 100,
            },
          },
        });

        const result = await addWorkspaceMember("workspace1", "johndoe", "DEVELOPER");

        expect(mockedFindUserByGitHubUsername).toHaveBeenCalledWith("johndoe");
        expect(mockedFindActiveMember).toHaveBeenCalledWith("workspace1", "user1");
        expect(mockedIsWorkspaceOwner).toHaveBeenCalledWith("workspace1", "user1");
        expect(mockedFindPreviousMember).toHaveBeenCalledWith("workspace1", "user1");
        expect(mockedCreateWorkspaceMember).toHaveBeenCalledWith("workspace1", "user1", "DEVELOPER");
        expect(mockedMapWorkspaceMember).toHaveBeenCalledWith(mockCreatedMember);

        expect(result.user.github?.username).toBe("johndoe");
      });

      test("should throw error if GitHub username not found", async () => {
        mockedFindUserByGitHubUsername.mockResolvedValue(null);

        await expect(
          addWorkspaceMember("workspace1", "nonexistent", "DEVELOPER")
        ).rejects.toThrow("User not found. They must sign up to Hive first.");
      });

      test("should throw error if user is already a member", async () => {
        mockedFindUserByGitHubUsername.mockResolvedValue(mockGitHubAuth);
        mockedFindActiveMember.mockResolvedValue({ id: "existing-member" });

        await expect(
          addWorkspaceMember("workspace1", "johndoe", "DEVELOPER")
        ).rejects.toThrow("User is already a member of this workspace");
      });

      test("should throw error if user is the workspace owner", async () => {
        mockedFindUserByGitHubUsername.mockResolvedValue(mockGitHubAuth);
        mockedFindActiveMember.mockResolvedValue(null);
        mockedIsWorkspaceOwner.mockResolvedValue(true);

        await expect(
          addWorkspaceMember("workspace1", "johndoe", "DEVELOPER")
        ).rejects.toThrow("Cannot add workspace owner as a member");
      });

      test("should reactivate previously removed member", async () => {
        const previousMember = {
          id: "previous-member-1",
          workspaceId: "workspace1",
          userId: "user1",
          role: "VIEWER",
          leftAt: new Date("2024-01-01"),
        };

        mockedFindUserByGitHubUsername.mockResolvedValue(mockGitHubAuth);
        mockedFindActiveMember.mockResolvedValue(null);
        mockedFindPreviousMember.mockResolvedValue(previousMember);
        mockedIsWorkspaceOwner.mockResolvedValue(false);
        mockedReactivateWorkspaceMember.mockResolvedValue(mockCreatedMember);
        mockedMapWorkspaceMember.mockReturnValue({
          id: "member1",
          userId: "user1",
          role: "DEVELOPER",
          joinedAt: "2024-01-01T00:00:00.000Z",
          user: {
            id: "user1",
            name: "John Doe",
            email: "john@example.com",
            image: "https://github.com/john.png",
            github: {
              username: "johndoe",
              name: "John Doe",
              bio: "Software Developer",
              publicRepos: 25,
              followers: 100,
            },
          },
        });

        const result = await addWorkspaceMember("workspace1", "johndoe", "DEVELOPER");

        expect(mockedReactivateWorkspaceMember).toHaveBeenCalledWith("previous-member-1", "DEVELOPER");
        expect(mockedCreateWorkspaceMember).not.toHaveBeenCalled();
        expect(result.user.github?.username).toBe("johndoe");
      });
    });

    describe("updateWorkspaceMemberRole", () => {
      const mockMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        role: "VIEWER",
      };

      const mockUpdatedMember = {
        id: "member1",
        userId: "user1",
        role: "DEVELOPER",
        joinedAt: new Date("2024-01-01"),
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/john.png",
          githubAuth: {
            githubUsername: "johndoe",
            name: "John Doe",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      };

      test("should update member role successfully", async () => {
        mockedFindActiveMember.mockResolvedValue(mockMember);
        mockedUpdateMemberRole.mockResolvedValue(mockUpdatedMember);
        mockedMapWorkspaceMember.mockReturnValue({
          id: "member1",
          userId: "user1",
          role: "DEVELOPER",
          joinedAt: "2024-01-01T00:00:00.000Z",
          user: {
            id: "user1",
            name: "John Doe",
            email: "john@example.com",
            image: "https://github.com/john.png",
            github: {
              username: "johndoe",
              name: "John Doe",
              bio: "Software Developer",
              publicRepos: 25,
              followers: 100,
            },
          },
        });

        const result = await updateWorkspaceMemberRole("workspace1", "user1", "DEVELOPER");

        expect(mockedFindActiveMember).toHaveBeenCalledWith("workspace1", "user1");
        expect(mockedUpdateMemberRole).toHaveBeenCalledWith("member1", "DEVELOPER");
        expect(mockedMapWorkspaceMember).toHaveBeenCalledWith(mockUpdatedMember);

        expect(result.role).toBe("DEVELOPER");
      });

      test("should throw error if member not found", async () => {
        mockedFindActiveMember.mockResolvedValue(null);

        await expect(
          updateWorkspaceMemberRole("workspace1", "user1", "DEVELOPER")
        ).rejects.toThrow("Member not found");
      });

      test("should throw error if trying to set same role", async () => {
        const memberWithAdminRole = {
          ...mockMember,
          role: "ADMIN",
        };
        mockedFindActiveMember.mockResolvedValue(memberWithAdminRole);

        await expect(
          updateWorkspaceMemberRole("workspace1", "user1", "ADMIN")
        ).rejects.toThrow("Member already has this role");
      });
    });

    describe("removeWorkspaceMember", () => {
      const mockMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        leftAt: null,
      };

      test("should remove member successfully", async () => {
        mockedFindActiveMember.mockResolvedValue(mockMember);
        mockedSoftDeleteMember.mockResolvedValue(undefined);

        await removeWorkspaceMember("workspace1", "user1");

        expect(mockedFindActiveMember).toHaveBeenCalledWith("workspace1", "user1");
        expect(mockedSoftDeleteMember).toHaveBeenCalledWith("member1");
      });

      test("should throw error if member not found", async () => {
        mockedFindActiveMember.mockResolvedValue(null);

        await expect(removeWorkspaceMember("workspace1", "user1")).rejects.toThrow("Member not found");
      });
    });
  });

  describe("updateWorkspace", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test("should update workspace successfully", async () => {
      const mockWorkspace = {
        id: "workspace1",
        name: "Original Workspace",
        slug: "original-workspace", 
        description: "Original description",
        userRole: "OWNER",
        ownerId: "user1",
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      };

      const updatedWorkspace = {
        id: "workspace1",
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description", 
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-02T00:00:00.000Z"),
        ownerId: "user1",
        stakworkApiKey: null,
      };

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace",
        description: "Updated description",
      };

      // Mock getWorkspaceBySlug to return workspace with OWNER role
      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce({
        id: "workspace1",
        name: "Original Workspace",
        slug: "original-workspace",
        description: "Original description",
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user1",
        stakworkApiKey: null,
        owner: { id: "user1", name: "User", email: "user@example.com" },
        swarm: null,
      });

      // Mock workspaceMember query for getWorkspaceBySlug
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);

      // Mock slug uniqueness check (no existing workspace with new slug)
      vi.mocked(db.workspace.findUnique).mockResolvedValueOnce(null);

      // Mock update operation
      vi.mocked(db.workspace.update).mockResolvedValueOnce(updatedWorkspace);

      const result = await updateWorkspace("original-workspace", "user1", updateData);

      expect(result).toEqual({
        id: "workspace1",
        name: "Updated Workspace",
        slug: "updated-workspace", 
        description: "Updated description",
        deleted: false,
        deletedAt: null,
        ownerId: "user1",
        stakworkApiKey: null,
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
      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(null);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);

      const updateData = {
        name: "Updated Workspace", 
        slug: "updated-workspace",
        description: "Updated description",
      };

      await expect(updateWorkspace("nonexistent", "user1", updateData)).rejects.toThrow("Workspace not found or access denied");
    });

    test("should throw error if user is not OWNER or ADMIN", async () => {
      const mockWorkspace = {
        id: "workspace1",
        name: "Test Workspace",
        slug: "test-workspace",
        description: "Test description",
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "owner1",
        stakworkApiKey: null,
        owner: { id: "owner1", name: "Owner", email: "owner@example.com" },
        swarm: null,
      };

      const mockMembership = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1", 
        role: "DEVELOPER" as const,
        joinedAt: new Date(),
        leftAt: null,
      };

      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(mockMembership);

      const updateData = {
        name: "Updated Workspace",
        slug: "updated-workspace", 
        description: "Updated description",
      };

      await expect(updateWorkspace("test-workspace", "user1", updateData)).rejects.toThrow("Only workspace owners and admins can update workspace settings");
    });

    test("should validate new slug if slug is changing", async () => {
      const mockWorkspace = {
        id: "workspace1",
        name: "Test Workspace",
        slug: "original-slug",
        description: "Test description",
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user1", 
        stakworkApiKey: null,
        owner: { id: "user1", name: "User", email: "user@example.com" },
        swarm: null,
      };

      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);

      const updateData = {
        name: "Test Workspace",
        slug: "api", // reserved slug
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_RESERVED);
    });

    test("should throw error if new slug already exists", async () => {
      const mockWorkspace = {
        id: "workspace1",
        name: "Test Workspace", 
        slug: "original-slug",
        description: "Test description",
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user1",
        stakworkApiKey: null,
        owner: { id: "user1", name: "User", email: "user@example.com" },
        swarm: null,
      };

      const existingWorkspace = {
        id: "workspace2",
        name: "Existing Workspace",
        slug: "existing-slug",
        description: null,
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user2",
        stakworkApiKey: null,
      };

      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValueOnce(existingWorkspace);

      const updateData = {
        name: "Test Workspace",
        slug: "existing-slug", 
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });

    test("should allow updating same slug (no change)", async () => {
      const mockWorkspace = {
        id: "workspace1",
        name: "Test Workspace",
        slug: "test-slug",
        description: "Original description",
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user1",
        stakworkApiKey: null,
        owner: { id: "user1", name: "User", email: "user@example.com" },
        swarm: null,
      };

      const updatedWorkspace = {
        ...mockWorkspace,
        description: "Updated description",
        updatedAt: new Date("2023-01-02T00:00:00.000Z"),
      };

      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);
      vi.mocked(db.workspace.update).mockResolvedValueOnce(updatedWorkspace);

      const updateData = {
        name: "Test Workspace",
        slug: "test-slug", // same slug
        description: "Updated description",
      };

      const result = await updateWorkspace("test-slug", "user1", updateData);

      expect(result.description).toBe("Updated description");
      // Should not call findUnique for slug check since slug didn't change
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("should handle Prisma unique constraint error", async () => {
      const mockWorkspace = {
        id: "workspace1", 
        name: "Test Workspace",
        slug: "original-slug",
        description: "Test description", 
        deleted: false,
        deletedAt: null,
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
        updatedAt: new Date("2023-01-01T00:00:00.000Z"),
        ownerId: "user1",
        stakworkApiKey: null,
        owner: { id: "user1", name: "User", email: "user@example.com" },
        swarm: null,
      };

      vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(mockWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValueOnce(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValueOnce(null);

      // Mock Prisma unique constraint error
      const prismaError = {
        code: "P2002",
        meta: { target: ["slug"] },
      };
      vi.mocked(db.workspace.update).mockRejectedValueOnce(prismaError);

      const updateData = {
        name: "Test Workspace",
        slug: "new-slug",
        description: "Test description",
      };

      await expect(updateWorkspace("original-slug", "user1", updateData)).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });
  });
});