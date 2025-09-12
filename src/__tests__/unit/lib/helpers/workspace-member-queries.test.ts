import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import {
  createWorkspaceMember,
  reactivateWorkspaceMember,
  updateMemberRole,
  softDeleteMember,
  findUserByGitHubUsername,
  findActiveMember,
  findPreviousMember,
  isWorkspaceOwner,
  getActiveWorkspaceMembers,
} from "@/lib/helpers/workspace-member-queries";
import { db } from "@/lib/db";
import { WORKSPACE_MEMBER_INCLUDE } from "@/lib/mappers/workspace-member";
import type { WorkspaceRole } from "@/lib/auth/roles";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspaceMember: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    gitHubAuth: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

describe("Workspace Member Queries - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("createWorkspaceMember", () => {
    const mockWorkspaceMember = {
      id: "member-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "DEVELOPER",
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      user: {
        id: "user-1",
        name: "John Doe",
        email: "john@example.com",
        image: "https://github.com/johndoe.png",
        githubAuth: {
          githubUsername: "johndoe",
          name: "John Doe",
          bio: "Software Developer",
          publicRepos: 25,
          followers: 100,
        },
      },
    };

    test("should create workspace member successfully", async () => {
      (db.workspaceMember.create as Mock).mockResolvedValue(mockWorkspaceMember);

      const result = await createWorkspaceMember(
        "workspace-1",
        "user-1",
        "DEVELOPER" as WorkspaceRole
      );

      expect(db.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: "workspace-1",
          userId: "user-1",
          role: "DEVELOPER",
        },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result).toEqual(mockWorkspaceMember);
    });

    test("should handle database errors during creation", async () => {
      const dbError = new Error("Database connection failed");
      (db.workspaceMember.create as Mock).mockRejectedValue(dbError);

      await expect(
        createWorkspaceMember("workspace-1", "user-1", "DEVELOPER" as WorkspaceRole)
      ).rejects.toThrow("Database connection failed");

      expect(db.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: "workspace-1",
          userId: "user-1",
          role: "DEVELOPER",
        },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
    });

    test("should handle Prisma constraint violations", async () => {
      const constraintError = {
        code: "P2002",
        meta: { target: ["workspaceId", "userId"] },
      };
      (db.workspaceMember.create as Mock).mockRejectedValue(constraintError);

      await expect(
        createWorkspaceMember("workspace-1", "user-1", "DEVELOPER" as WorkspaceRole)
      ).rejects.toEqual(constraintError);
    });

    test("should create member with different roles", async () => {
      const adminMember = { ...mockWorkspaceMember, role: "ADMIN" };
      (db.workspaceMember.create as Mock).mockResolvedValue(adminMember);

      const result = await createWorkspaceMember(
        "workspace-1",
        "user-1",
        "ADMIN" as WorkspaceRole
      );

      expect(db.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: "workspace-1",
          userId: "user-1",
          role: "ADMIN",
        },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result.role).toBe("ADMIN");
    });
  });

  describe("reactivateWorkspaceMember", () => {
    const mockReactivatedMember = {
      id: "member-1",
      workspaceId: "workspace-1", 
      userId: "user-1",
      role: "DEVELOPER",
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      user: {
        id: "user-1",
        name: "John Doe",
        email: "john@example.com",
        image: "https://github.com/johndoe.png",
        githubAuth: {
          githubUsername: "johndoe",
          name: "John Doe",
          bio: "Software Developer",
          publicRepos: 25,
          followers: 100,
        },
      },
    };

    test("should reactivate workspace member successfully", async () => {
      (db.workspaceMember.update as Mock).mockResolvedValue(mockReactivatedMember);

      const result = await reactivateWorkspaceMember(
        "member-1",
        "DEVELOPER" as WorkspaceRole
      );

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: {
          role: "DEVELOPER",
          leftAt: null,
          joinedAt: expect.any(Date),
        },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result).toEqual(mockReactivatedMember);
    });

    test("should handle member not found during reactivation", async () => {
      const notFoundError = {
        code: "P2025",
        meta: { cause: "Record to update not found." },
      };
      (db.workspaceMember.update as Mock).mockRejectedValue(notFoundError);

      await expect(
        reactivateWorkspaceMember("non-existent-member", "DEVELOPER" as WorkspaceRole)
      ).rejects.toEqual(notFoundError);
    });

    test("should reactivate with new role different from previous", async () => {
      const adminReactivated = { ...mockReactivatedMember, role: "ADMIN" };
      (db.workspaceMember.update as Mock).mockResolvedValue(adminReactivated);

      const result = await reactivateWorkspaceMember(
        "member-1", 
        "ADMIN" as WorkspaceRole
      );

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: {
          role: "ADMIN",
          leftAt: null,
          joinedAt: expect.any(Date),
        },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result.role).toBe("ADMIN");
    });
  });

  describe("updateMemberRole", () => {
    const mockUpdatedMember = {
      id: "member-1",
      workspaceId: "workspace-1",
      userId: "user-1", 
      role: "ADMIN",
      joinedAt: new Date("2024-01-01"),
      leftAt: null,
      user: {
        id: "user-1",
        name: "John Doe",
        email: "john@example.com",
        image: "https://github.com/johndoe.png",
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
      (db.workspaceMember.update as Mock).mockResolvedValue(mockUpdatedMember);

      const result = await updateMemberRole("member-1", "ADMIN" as WorkspaceRole);

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: { role: "ADMIN" },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result).toEqual(mockUpdatedMember);
    });

    test("should handle member not found during role update", async () => {
      const notFoundError = {
        code: "P2025", 
        meta: { cause: "Record to update not found." },
      };
      (db.workspaceMember.update as Mock).mockRejectedValue(notFoundError);

      await expect(
        updateMemberRole("non-existent-member", "ADMIN" as WorkspaceRole)
      ).rejects.toEqual(notFoundError);
    });

    test("should update role from DEVELOPER to PM", async () => {
      const pmMember = { ...mockUpdatedMember, role: "PM" };
      (db.workspaceMember.update as Mock).mockResolvedValue(pmMember);

      const result = await updateMemberRole("member-1", "PM" as WorkspaceRole);

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: { role: "PM" },
        include: WORKSPACE_MEMBER_INCLUDE,
      });
      expect(result.role).toBe("PM");
    });
  });

  describe("softDeleteMember", () => {
    test("should soft delete member successfully", async () => {
      const mockDeletedMember = {
        id: "member-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "DEVELOPER", 
        joinedAt: new Date("2024-01-01"),
        leftAt: new Date("2024-02-01"),
      };

      (db.workspaceMember.update as Mock).mockResolvedValue(mockDeletedMember);

      await softDeleteMember("member-1");

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: { leftAt: expect.any(Date) },
      });
    });

    test("should handle member not found during soft delete", async () => {
      const notFoundError = {
        code: "P2025",
        meta: { cause: "Record to update not found." },
      };
      (db.workspaceMember.update as Mock).mockRejectedValue(notFoundError);

      await expect(softDeleteMember("non-existent-member")).rejects.toEqual(
        notFoundError
      );
    });

    test("should update leftAt timestamp correctly", async () => {
      const now = new Date("2024-02-01T10:00:00Z");
      vi.setSystemTime(now);

      await softDeleteMember("member-1");

      expect(db.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: "member-1" },
        data: { leftAt: now },
      });

      vi.useRealTimers();
    });
  });

  describe("findUserByGitHubUsername", () => {
    test("should find user by GitHub username successfully", async () => {
      const mockGitHubAuth = {
        userId: "user-1",
        githubUsername: "johndoe",
        user: {
          id: "user-1", 
          name: "John Doe",
          email: "john@example.com",
        },
      };

      (db.gitHubAuth.findFirst as Mock).mockResolvedValue(mockGitHubAuth);

      const result = await findUserByGitHubUsername("johndoe");

      expect(db.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: "johndoe" },
        include: { user: true },
      });
      expect(result).toEqual(mockGitHubAuth);
    });

    test("should return null when user not found", async () => {
      (db.gitHubAuth.findFirst as Mock).mockResolvedValue(null);

      const result = await findUserByGitHubUsername("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("isWorkspaceOwner", () => {
    test("should return true when user is workspace owner", async () => {
      const mockWorkspace = {
        id: "workspace-1",
        ownerId: "user-1",
      };

      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await isWorkspaceOwner("workspace-1", "user-1");

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "workspace-1" },
        select: { ownerId: true },
      });
      expect(result).toBe(true);
    });

    test("should return false when user is not workspace owner", async () => {
      const mockWorkspace = {
        id: "workspace-1", 
        ownerId: "different-user",
      };

      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await isWorkspaceOwner("workspace-1", "user-1");

      expect(result).toBe(false);
    });

    test("should return false when workspace not found", async () => {
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const result = await isWorkspaceOwner("non-existent", "user-1");

      expect(result).toBe(false);
    });
  });

  describe("Database error handling", () => {
    test("should handle connection errors gracefully", async () => {
      const connectionError = new Error("Connection to database failed");
      (db.workspaceMember.create as Mock).mockRejectedValue(connectionError);

      await expect(
        createWorkspaceMember("workspace-1", "user-1", "DEVELOPER" as WorkspaceRole)
      ).rejects.toThrow("Connection to database failed");
    });

    test("should handle timeout errors", async () => {
      const timeoutError = new Error("Query timeout");
      (db.workspaceMember.update as Mock).mockRejectedValue(timeoutError);

      await expect(
        updateMemberRole("member-1", "ADMIN" as WorkspaceRole)
      ).rejects.toThrow("Query timeout");
    });

    test("should preserve original error details", async () => {
      const originalError = {
        code: "P2002",
        message: "Unique constraint failed",
        meta: { target: ["workspaceId", "userId"] },
      };
      (db.workspaceMember.create as Mock).mockRejectedValue(originalError);

      await expect(
        createWorkspaceMember("workspace-1", "user-1", "DEVELOPER" as WorkspaceRole)  
      ).rejects.toEqual(originalError);
    });
  });
});