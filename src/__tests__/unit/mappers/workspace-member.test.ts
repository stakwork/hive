import { describe, test, expect } from "vitest";
import {
  mapWorkspaceMember,
  mapWorkspaceMembers,
  WORKSPACE_MEMBER_INCLUDE,
  type PrismaWorkspaceMemberWithUser,
} from "@/lib/mappers/workspace-member";

describe("Workspace Member Mappers - Unit Tests", () => {
  const mockPrismaWorkspaceMember: PrismaWorkspaceMemberWithUser = {
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

  const mockPrismaWorkspaceMemberWithoutGitHub: PrismaWorkspaceMemberWithUser = {
    id: "member2",
    userId: "user2",
    role: "VIEWER",
    joinedAt: new Date("2024-01-02"),
    user: {
      id: "user2",
      name: "Jane Smith",
      email: "jane@example.com",
      image: null,
      githubAuth: null,
    },
  };

  describe("WORKSPACE_MEMBER_INCLUDE", () => {
    test("should have correct include structure", () => {
      expect(WORKSPACE_MEMBER_INCLUDE).toEqual({
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
      });
    });
  });

  describe("mapWorkspaceMember", () => {
    test("should map workspace member with GitHub auth correctly", () => {
      const result = mapWorkspaceMember(mockPrismaWorkspaceMember);

      expect(result).toEqual({
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
    });

    test("should map workspace member without GitHub auth correctly", () => {
      const result = mapWorkspaceMember(mockPrismaWorkspaceMemberWithoutGitHub);

      expect(result).toEqual({
        id: "member2",
        userId: "user2",
        role: "VIEWER",
        joinedAt: "2024-01-02T00:00:00.000Z",
        user: {
          id: "user2",
          name: "Jane Smith",
          email: "jane@example.com",
          image: null,
          github: null,
        },
      });
    });

    test("should handle null values correctly", () => {
      const memberWithNulls: PrismaWorkspaceMemberWithUser = {
        id: "member3",
        userId: "user3",
        role: "PM",
        joinedAt: new Date("2024-01-03"),
        user: {
          id: "user3",
          name: null,
          email: null,
          image: null,
          githubAuth: {
            githubUsername: "user3",
            name: null,
            bio: null,
            publicRepos: null,
            followers: null,
          },
        },
      };

      const result = mapWorkspaceMember(memberWithNulls);

      expect(result).toEqual({
        id: "member3",
        userId: "user3",
        role: "PM",
        joinedAt: "2024-01-03T00:00:00.000Z",
        user: {
          id: "user3",
          name: null,
          email: null,
          image: null,
          github: {
            username: "user3",
            name: null,
            bio: null,
            publicRepos: null,
            followers: null,
          },
        },
      });
    });

    test("should handle different role types", () => {
      const roles = ["OWNER", "ADMIN", "PM", "DEVELOPER", "STAKEHOLDER", "VIEWER"];
      
      roles.forEach((role) => {
        const member = {
          ...mockPrismaWorkspaceMember,
          id: `member-${role.toLowerCase()}`,
          role,
        };
        
        const result = mapWorkspaceMember(member);
        expect(result.role).toBe(role);
      });
    });

    test("should convert joinedAt date to ISO string", () => {
      const testDate = new Date("2024-05-15T14:30:00Z");
      const member = {
        ...mockPrismaWorkspaceMember,
        joinedAt: testDate,
      };

      const result = mapWorkspaceMember(member);
      expect(result.joinedAt).toBe("2024-05-15T14:30:00.000Z");
    });
  });

  describe("mapWorkspaceMembers", () => {
    test("should map multiple workspace members correctly", () => {
      const members = [mockPrismaWorkspaceMember, mockPrismaWorkspaceMemberWithoutGitHub];
      
      const result = mapWorkspaceMembers(members);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
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
      expect(result[1]).toEqual({
        id: "member2",
        userId: "user2",
        role: "VIEWER",
        joinedAt: "2024-01-02T00:00:00.000Z",
        user: {
          id: "user2",
          name: "Jane Smith",
          email: "jane@example.com",
          image: null,
          github: null,
        },
      });
    });

    test("should handle empty array", () => {
      const result = mapWorkspaceMembers([]);
      expect(result).toEqual([]);
    });

    test("should handle single member", () => {
      const result = mapWorkspaceMembers([mockPrismaWorkspaceMember]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("member1");
    });

    test("should maintain order of members", () => {
      const member1 = { ...mockPrismaWorkspaceMember, id: "first" };
      const member2 = { ...mockPrismaWorkspaceMemberWithoutGitHub, id: "second" };
      const member3 = { ...mockPrismaWorkspaceMember, id: "third" };

      const result = mapWorkspaceMembers([member1, member2, member3]);
      
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("first");
      expect(result[1].id).toBe("second");
      expect(result[2].id).toBe("third");
    });
  });
});