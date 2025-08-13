import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { db } from "@/lib/db";
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

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    gitHubAuth: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

describe("Workspace Member Query Helpers - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findUserByGitHubUsername", () => {
    test("should find user by GitHub username", async () => {
      const mockResult = {
        userId: "user1",
        githubUsername: "johndoe",
        user: { id: "user1", name: "John Doe" },
      };

      (db.gitHubAuth.findFirst as Mock).mockResolvedValue(mockResult);

      const result = await findUserByGitHubUsername("johndoe");

      expect(db.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: "johndoe" },
        include: { user: true },
      });
      expect(result).toEqual(mockResult);
    });

    test("should return null if user not found", async () => {
      (db.gitHubAuth.findFirst as Mock).mockResolvedValue(null);

      const result = await findUserByGitHubUsername("nonexistent");

      expect(result).toBeNull();
    });

    test("should handle case-sensitive username", async () => {
      (db.gitHubAuth.findFirst as Mock).mockResolvedValue(null);

      await findUserByGitHubUsername("JohnDoe");

      expect(db.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: "JohnDoe" },
        include: { user: true },
      });
    });
  });

  describe("findActiveMember", () => {
    test("should find active member", async () => {
      const mockMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        leftAt: null,
      };

      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockMember);

      const result = await findActiveMember("workspace1", "user1");

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace1",
          userId: "user1",
          leftAt: null,
        },
      });
      expect(result).toEqual(mockMember);
    });

    test("should return null if no active member found", async () => {
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      const result = await findActiveMember("workspace1", "user1");

      expect(result).toBeNull();
    });
  });

  describe("findPreviousMember", () => {
    test("should find most recent previous member", async () => {
      const mockPreviousMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        leftAt: new Date("2024-01-01"),
      };

      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockPreviousMember);

      const result = await findPreviousMember("workspace1", "user1");

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace1",
          userId: "user1",
          leftAt: { not: null },
        },
        orderBy: { leftAt: "desc" },
      });
      expect(result).toEqual(mockPreviousMember);
    });

    test("should return null if no previous member found", async () => {
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      const result = await findPreviousMember("workspace1", "user1");

      expect(result).toBeNull();
    });
  });

  describe("isWorkspaceOwner", () => {
    test("should return true if user is owner", async () => {
      (db.workspace.findUnique as Mock).mockResolvedValue({ ownerId: "user1" });

      const result = await isWorkspaceOwner("workspace1", "user1");

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "workspace1" },
        select: { ownerId: true },
      });
      expect(result).toBe(true);
    });

    test("should return false if user is not owner", async () => {
      (db.workspace.findUnique as Mock).mockResolvedValue({ ownerId: "other-user" });

      const result = await isWorkspaceOwner("workspace1", "user1");

      expect(result).toBe(false);
    });

    test("should return false if workspace not found", async () => {
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const result = await isWorkspaceOwner("nonexistent", "user1");

      expect(result).toBe(false);
    });
  });

  describe("createWorkspaceMember", () => {
    test("should create workspace member with correct data and includes", async () => {
      const mockCreatedMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        role: "DEVELOPER",
        joinedAt: new Date("2024-01-01"),
        user: {
          id: "user1",
          name: "John Doe",
          githubAuth: {
            githubUsername: "johndoe",
            name: "John Doe",
            bio: "Developer",
          },
        },
      };

      (db.workspaceMember.create as Mock).mockResolvedValue(mockCreatedMember);

      const result = await createWorkspaceMember("workspace1", "user1", "DEVELOPER");

      expect(db.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: "workspace1",
          userId: "user1",
          role: "DEVELOPER",
        },
        include: {
          user: {
            include: {
              githubAuth: {
                select: {
                  githubUsername: true,
                  name: true,
                  bio: true,
                  publicRepos: true,
                  followers: true,
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockCreatedMember);
    });
  });

  describe("reactivateWorkspaceMember", () => {
    test("should reactivate member with new role", async () => {
      const mockReactivatedMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        role: "PM",
        joinedAt: new Date("2024-01-15"),
        leftAt: null,
        user: {
          id: "user1",
          name: "John Doe",
          githubAuth: {
            githubUsername: "johndoe",
            name: "John Doe",
            bio: "Product Manager",
          },
        },
      };

      (db.workspaceMember.update as Mock).mockResolvedValue(mockReactivatedMember);

      const result = await reactivateWorkspaceMember("member1", "PM");

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member1" },
        data: {
          role: "PM",
          leftAt: null,
          joinedAt: expect.any(Date),
        },
        include: {
          user: {
            include: {
              githubAuth: {
                select: {
                  githubUsername: true,
                  name: true,
                  bio: true,
                  publicRepos: true,
                  followers: true,
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockReactivatedMember);
    });
  });

  describe("getActiveWorkspaceMembers", () => {
    test("should get all active workspace members", async () => {
      const mockMembers = [
        {
          id: "member1",
          workspaceId: "workspace1",
          userId: "user1",
          role: "DEVELOPER",
          joinedAt: new Date("2024-01-01"),
          user: { id: "user1", name: "John Doe" },
        },
        {
          id: "member2",
          workspaceId: "workspace1",
          userId: "user2",
          role: "PM",
          joinedAt: new Date("2024-01-02"),
          user: { id: "user2", name: "Jane Smith" },
        },
      ];

      (db.workspaceMember.findMany as Mock).mockResolvedValue(mockMembers);

      const result = await getActiveWorkspaceMembers("workspace1");

      expect(db.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace1",
          leftAt: null,
        },
        include: {
          user: {
            include: {
              githubAuth: {
                select: {
                  githubUsername: true,
                  name: true,
                  bio: true,
                  publicRepos: true,
                  followers: true,
                },
              },
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      });
      expect(result).toEqual(mockMembers);
    });

    test("should return empty array if no active members", async () => {
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getActiveWorkspaceMembers("workspace1");

      expect(result).toEqual([]);
    });
  });

  describe("updateMemberRole", () => {
    test("should update member role", async () => {
      const mockUpdatedMember = {
        id: "member1",
        workspaceId: "workspace1",
        userId: "user1",
        role: "ADMIN",
        user: { id: "user1", name: "John Doe" },
      };

      (db.workspaceMember.update as Mock).mockResolvedValue(mockUpdatedMember);

      const result = await updateMemberRole("member1", "ADMIN");

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member1" },
        data: { role: "ADMIN" },
        include: {
          user: {
            include: {
              githubAuth: {
                select: {
                  githubUsername: true,
                  name: true,
                  bio: true,
                  publicRepos: true,
                  followers: true,
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockUpdatedMember);
    });
  });

  describe("softDeleteMember", () => {
    test("should soft delete member by setting leftAt timestamp", async () => {
      (db.workspaceMember.update as Mock).mockResolvedValue({});

      await softDeleteMember("member1");

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member1" },
        data: { leftAt: expect.any(Date) },
      });
    });

    test("should call with current timestamp", async () => {
      const beforeCall = new Date();
      (db.workspaceMember.update as Mock).mockResolvedValue({});

      await softDeleteMember("member1");
      const afterCall = new Date();

      const callArgs = (db.workspaceMember.update as Mock).mock.calls[0][0];
      const leftAtValue = callArgs.data.leftAt;

      expect(leftAtValue).toBeInstanceOf(Date);
      expect(leftAtValue.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(leftAtValue.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });
});