import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
} from "@/services/workspace";
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
import { mapWorkspaceMember, mapWorkspaceMembers } from "@/lib/mappers/workspace-member";
import { mockData } from "@/__tests__/support/fixtures/static-fixtures";
import { TEST_DATE, TEST_DATE_ISO } from "@/__tests__/support/helpers/service-mocks/workspace-mocks";

const mockedDb = vi.mocked(db);

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

describe("Workspace Member Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWorkspaceMembers", () => {
    test("should return workspace members with user and GitHub data", async () => {
      const mockMembers = [
        mockData.memberWithGithub("DEVELOPER", {
          id: "member1",
          userId: "user1",
          workspaceId: "workspace1",
          username: "johndoe",
          name: "John Doe",
          email: "john@example.com",
        }),
        mockData.memberWithGithub("PM", {
          id: "member2",
          userId: "user2",
          workspaceId: "workspace1",
          username: "janesmith",
          name: "Jane Smith",
          email: "jane@example.com",
          bio: "Product Manager",
          publicRepos: 15,
          followers: 50,
        }),
      ];

      const mockWorkspace = {
        id: "workspace1",
        createdAt: TEST_DATE,
        owner: {
          id: "owner1",
          name: "Workspace Owner",
          email: "owner@example.com",
          image: "https://github.com/workspaceowner.png",
          githubAuth: mockData.githubAuth({
            userId: "owner1",
            githubUsername: "workspaceowner",
            name: "Workspace Owner",
            bio: "Team Lead",
            publicRepos: 30,
            followers: 200,
          }),
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      mockedDb.workspace.findUnique.mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(mockedGetActiveWorkspaceMembers).toHaveBeenCalledWith("workspace1");
      expect(mockedMapWorkspaceMembers).toHaveBeenCalledWith(mockMembers);
      expect(result).toEqual({
        members: mockMembers,
        owner: {
          id: "owner1",
          userId: "owner1",
          role: "OWNER",
          joinedAt: TEST_DATE_ISO,
          user: {
            id: "owner1",
            name: "Workspace Owner",
            email: "owner@example.com",
            image: "https://github.com/workspaceowner.png",
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
          role: "VIEWER" as const,
          joinedAt: TEST_DATE,
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
        createdAt: TEST_DATE,
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
      mockedDb.workspace.findUnique.mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result).toEqual({
        members: mockMembers,
        owner: {
          id: "owner1",
          userId: "owner1",
          role: "OWNER",
          joinedAt: TEST_DATE_ISO,
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
    const mockGitHubAuth = mockData.githubAuth({
      userId: "user1",
      githubUsername: "johndoe",
    });

    const mockCreatedMember = mockData.memberWithGithub("DEVELOPER", {
      id: "member1",
      userId: "user1",
      workspaceId: "workspace1",
      username: "johndoe",
      name: "John Doe",
      email: "john@example.com",
    });

    test("should add workspace member successfully", async () => {
      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/johndoe.png",
        },
      });
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
          image: "https://github.com/johndoe.png",
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

      await expect(addWorkspaceMember("workspace1", "nonexistent", "DEVELOPER")).rejects.toThrow(
        "User not found. They must sign up to Hive first.",
      );
    });

    test("should throw error if user is already a member", async () => {
      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: mockCreatedMember.user,
      });
      mockedFindActiveMember.mockResolvedValue({ id: "existing-member" });

      await expect(addWorkspaceMember("workspace1", "johndoe", "DEVELOPER")).rejects.toThrow(
        "User is already a member of this workspace",
      );
    });

    test("should throw error if user is the workspace owner", async () => {
      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: mockCreatedMember.user,
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedIsWorkspaceOwner.mockResolvedValue(true);

      await expect(addWorkspaceMember("workspace1", "johndoe", "DEVELOPER")).rejects.toThrow(
        "Cannot add workspace owner as a member",
      );
    });

    test("should reactivate previously removed member", async () => {
      const previousMember = {
        id: "previous-member-1",
        workspaceId: "workspace1",
        userId: "user1",
        role: "VIEWER" as const,
        leftAt: new Date("2024-01-01"),
      };

      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: mockCreatedMember.user,
      });
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
          image: "https://github.com/johndoe.png",
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

    test("should add member with VIEWER role successfully", async () => {
      const mockViewerMember = mockData.memberWithGithub("VIEWER", {
        id: "member2",
        userId: "user2",
        workspaceId: "workspace1",
        username: "viewer-user",
        name: "Viewer User",
        email: "viewer@example.com",
      });

      mockedFindUserByGitHubUsername.mockResolvedValue({
        userId: "user2",
        githubId: 123456,
        githubUsername: "viewer-user",
        accessToken: "test-token",
        user: {
          id: "user2",
          name: "Viewer User",
          email: "viewer@example.com",
          image: "https://github.com/viewer-user.png",
        },
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(null);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedCreateWorkspaceMember.mockResolvedValue(mockViewerMember);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "member2",
        userId: "user2",
        role: "VIEWER",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user2",
          name: "Viewer User",
          email: "viewer@example.com",
          image: "https://github.com/viewer-user.png",
          github: {
            username: "viewer-user",
            name: "Viewer User",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      const result = await addWorkspaceMember("workspace1", "viewer-user", "VIEWER");

      expect(mockedCreateWorkspaceMember).toHaveBeenCalledWith("workspace1", "user2", "VIEWER");
      expect(result.role).toBe("VIEWER");
    });

    test("should add member with PM role successfully", async () => {
      const mockPmMember = mockData.memberWithGithub("PM", {
        id: "member3",
        userId: "user3",
        workspaceId: "workspace1",
        username: "pm-user",
        name: "Product Manager",
        email: "pm@example.com",
      });

      mockedFindUserByGitHubUsername.mockResolvedValue({
        userId: "user3",
        githubId: 123456,
        githubUsername: "pm-user",
        accessToken: "test-token",
        user: {
          id: "user3",
          name: "Product Manager",
          email: "pm@example.com",
          image: "https://github.com/pm-user.png",
        },
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(null);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedCreateWorkspaceMember.mockResolvedValue(mockPmMember);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "member3",
        userId: "user3",
        role: "PM",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user3",
          name: "Product Manager",
          email: "pm@example.com",
          image: "https://github.com/pm-user.png",
          github: {
            username: "pm-user",
            name: "Product Manager",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      const result = await addWorkspaceMember("workspace1", "pm-user", "PM");

      expect(mockedCreateWorkspaceMember).toHaveBeenCalledWith("workspace1", "user3", "PM");
      expect(result.role).toBe("PM");
    });

    test("should add member with ADMIN role successfully", async () => {
      const mockAdminMember = mockData.memberWithGithub("ADMIN", {
        id: "member4",
        userId: "user4",
        workspaceId: "workspace1",
        username: "admin-user",
        name: "Admin User",
        email: "admin@example.com",
      });

      mockedFindUserByGitHubUsername.mockResolvedValue({
        userId: "user4",
        githubId: 123456,
        githubUsername: "admin-user",
        accessToken: "test-token",
        user: {
          id: "user4",
          name: "Admin User",
          email: "admin@example.com",
          image: "https://github.com/admin-user.png",
        },
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(null);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedCreateWorkspaceMember.mockResolvedValue(mockAdminMember);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "member4",
        userId: "user4",
        role: "ADMIN",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user4",
          name: "Admin User",
          email: "admin@example.com",
          image: "https://github.com/admin-user.png",
          github: {
            username: "admin-user",
            name: "Admin User",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      const result = await addWorkspaceMember("workspace1", "admin-user", "ADMIN");

      expect(mockedCreateWorkspaceMember).toHaveBeenCalledWith("workspace1", "user4", "ADMIN");
      expect(result.role).toBe("ADMIN");
    });

    test("should reactivate member with role upgrade from VIEWER to ADMIN", async () => {
      const previousMember = {
        id: "previous-member-2",
        workspaceId: "workspace1",
        userId: "user5",
        role: "VIEWER" as const,
        leftAt: new Date("2024-01-01"),
      };

      const mockReactivatedAdmin = mockData.memberWithGithub("ADMIN", {
        id: "previous-member-2",
        userId: "user5",
        workspaceId: "workspace1",
        username: "upgraded-user",
        name: "Upgraded User",
        email: "upgraded@example.com",
      });

      mockedFindUserByGitHubUsername.mockResolvedValue({
        userId: "user5",
        githubId: 123456,
        githubUsername: "upgraded-user",
        accessToken: "test-token",
        user: {
          id: "user5",
          name: "Upgraded User",
          email: "upgraded@example.com",
          image: "https://github.com/upgraded-user.png",
        },
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(previousMember);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedReactivateWorkspaceMember.mockResolvedValue(mockReactivatedAdmin);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "previous-member-2",
        userId: "user5",
        role: "ADMIN",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user5",
          name: "Upgraded User",
          email: "upgraded@example.com",
          image: "https://github.com/upgraded-user.png",
          github: {
            username: "upgraded-user",
            name: "Upgraded User",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      const result = await addWorkspaceMember("workspace1", "upgraded-user", "ADMIN");

      expect(mockedReactivateWorkspaceMember).toHaveBeenCalledWith("previous-member-2", "ADMIN");
      expect(mockedCreateWorkspaceMember).not.toHaveBeenCalled();
      expect(result.role).toBe("ADMIN");
    });

    test("should reactivate member with role downgrade from PM to DEVELOPER", async () => {
      const previousMember = {
        id: "previous-member-3",
        workspaceId: "workspace1",
        userId: "user6",
        role: "PM" as const,
        leftAt: new Date("2024-01-01"),
      };

      const mockReactivatedDeveloper = mockData.memberWithGithub("DEVELOPER", {
        id: "previous-member-3",
        userId: "user6",
        workspaceId: "workspace1",
        username: "downgraded-user",
        name: "Downgraded User",
        email: "downgraded@example.com",
      });

      mockedFindUserByGitHubUsername.mockResolvedValue({
        userId: "user6",
        githubId: 123456,
        githubUsername: "downgraded-user",
        accessToken: "test-token",
        user: {
          id: "user6",
          name: "Downgraded User",
          email: "downgraded@example.com",
          image: "https://github.com/downgraded-user.png",
        },
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(previousMember);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedReactivateWorkspaceMember.mockResolvedValue(mockReactivatedDeveloper);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "previous-member-3",
        userId: "user6",
        role: "DEVELOPER",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user6",
          name: "Downgraded User",
          email: "downgraded@example.com",
          image: "https://github.com/downgraded-user.png",
          github: {
            username: "downgraded-user",
            name: "Downgraded User",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      const result = await addWorkspaceMember("workspace1", "downgraded-user", "DEVELOPER");

      expect(mockedReactivateWorkspaceMember).toHaveBeenCalledWith("previous-member-3", "DEVELOPER");
      expect(mockedCreateWorkspaceMember).not.toHaveBeenCalled();
      expect(result.role).toBe("DEVELOPER");
    });

    test("should verify correct role is passed to createWorkspaceMember", async () => {
      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: mockCreatedMember.user,
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(null);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedCreateWorkspaceMember.mockResolvedValue(mockCreatedMember);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "member1",
        userId: "user1",
        role: "PM",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/johndoe.png",
          github: {
            username: "johndoe",
            name: "John Doe",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      await addWorkspaceMember("workspace1", "johndoe", "PM");

      const createCall = mockedCreateWorkspaceMember.mock.calls[0];
      expect(createCall[0]).toBe("workspace1");
      expect(createCall[1]).toBe("user1");
      expect(createCall[2]).toBe("PM");
    });

    test("should verify correct role is passed to reactivateWorkspaceMember", async () => {
      const previousMember = {
        id: "previous-member-4",
        workspaceId: "workspace1",
        userId: "user1",
        role: "DEVELOPER" as const,
        leftAt: new Date("2024-01-01"),
      };

      mockedFindUserByGitHubUsername.mockResolvedValue({
        ...mockGitHubAuth,
        user: mockCreatedMember.user,
      });
      mockedFindActiveMember.mockResolvedValue(null);
      mockedFindPreviousMember.mockResolvedValue(previousMember);
      mockedIsWorkspaceOwner.mockResolvedValue(false);
      mockedReactivateWorkspaceMember.mockResolvedValue(mockCreatedMember);
      mockedMapWorkspaceMember.mockReturnValue({
        id: "member1",
        userId: "user1",
        role: "VIEWER",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user1",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/johndoe.png",
          github: {
            username: "johndoe",
            name: "John Doe",
            bio: "Software Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      });

      await addWorkspaceMember("workspace1", "johndoe", "VIEWER");

      const reactivateCall = mockedReactivateWorkspaceMember.mock.calls[0];
      expect(reactivateCall[0]).toBe("previous-member-4");
      expect(reactivateCall[1]).toBe("VIEWER");
    });
  });

  describe("updateWorkspaceMemberRole", () => {
    const mockMember = {
      id: "member1",
      workspaceId: "workspace1",
      userId: "user1",
      role: "VIEWER" as const,
    };

    const mockUpdatedMember = mockData.memberWithGithub("DEVELOPER", {
      id: "member1",
      userId: "user1",
      workspaceId: "workspace1",
      username: "johndoe",
      name: "John Doe",
      email: "john@example.com",
    });

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

      await expect(updateWorkspaceMemberRole("workspace1", "user1", "DEVELOPER")).rejects.toThrow("Member not found");
    });

    test("should throw error if trying to set same role", async () => {
      const memberWithAdminRole = {
        ...mockMember,
        role: "ADMIN",
      };
      mockedFindActiveMember.mockResolvedValue(memberWithAdminRole);

      await expect(updateWorkspaceMemberRole("workspace1", "user1", "ADMIN")).rejects.toThrow(
        "Member already has this role",
      );
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
