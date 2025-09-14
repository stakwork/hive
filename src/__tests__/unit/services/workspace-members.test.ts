import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getWorkspaceMembers } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  getActiveWorkspaceMembers,
} from "@/lib/helpers/workspace-member-queries";
import { mapWorkspaceMembers } from "@/lib/mappers/workspace-member";

// Mock all dependencies
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/helpers/workspace-member-queries", () => ({
  getActiveWorkspaceMembers: vi.fn(),
}));

vi.mock("@/lib/mappers/workspace-member", () => ({
  mapWorkspaceMembers: vi.fn(),
}));

// Type the mocked functions
const mockedGetActiveWorkspaceMembers = vi.mocked(getActiveWorkspaceMembers);
const mockedMapWorkspaceMembers = vi.mocked(mapWorkspaceMembers);

describe("getWorkspaceMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful member retrieval", () => {
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

    test("should handle workspace with no regular members", async () => {
      const mockMembers = [];

      const mockWorkspace = {
        id: "workspace1",
        createdAt: new Date("2024-01-01"),
        owner: {
          id: "owner1",
          name: "Solo Owner",
          email: "solo@example.com",
          image: null,
          githubAuth: {
            githubUsername: "soloowner",
            name: "Solo Owner",
            bio: "Solo Developer",
            publicRepos: 10,
            followers: 5,
          },
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result.members).toEqual([]);
      expect(result.owner).toEqual({
        id: "owner1",
        userId: "owner1",
        role: "OWNER",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "owner1",
          name: "Solo Owner",
          email: "solo@example.com",
          image: null,
          github: {
            username: "soloowner",
            name: "Solo Owner",
            bio: "Solo Developer",
            publicRepos: 10,
            followers: 5,
          },
        },
      });
    });

    test("should handle partial GitHub auth data", async () => {
      const mockMembers = [];

      const mockWorkspace = {
        id: "workspace1",
        createdAt: new Date("2024-01-01"),
        owner: {
          id: "owner1",
          name: "Owner With Partial GitHub",
          email: "partial@example.com",
          image: null,
          githubAuth: {
            githubUsername: "partialuser",
            name: "Partial User",
            bio: null,
            publicRepos: null,
            followers: null,
          },
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result.owner.user.github).toEqual({
        username: "partialuser",
        name: "Partial User",
        bio: null,
        publicRepos: null,
        followers: null,
      });
    });
  });

  describe("error handling", () => {
    test("should throw error when workspace not found", async () => {
      mockedGetActiveWorkspaceMembers.mockResolvedValue([]);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      await expect(getWorkspaceMembers("nonexistent-workspace")).rejects.toThrow(
        "Workspace not found"
      );
    });

    test("should handle database errors from getActiveWorkspaceMembers", async () => {
      const dbError = new Error("Database connection failed");
      mockedGetActiveWorkspaceMembers.mockRejectedValue(dbError);

      await expect(getWorkspaceMembers("workspace1")).rejects.toThrow(
        "Database connection failed"
      );
    });

    test("should handle database errors from workspace query", async () => {
      const dbError = new Error("Workspace query failed");
      mockedGetActiveWorkspaceMembers.mockResolvedValue([]);
      (db.workspace.findUnique as Mock).mockRejectedValue(dbError);

      await expect(getWorkspaceMembers("workspace1")).rejects.toThrow(
        "Workspace query failed"
      );
    });

    test("should handle mapping errors", async () => {
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
      mockedMapWorkspaceMembers.mockImplementation(() => {
        throw new Error("Mapping failed");
      });
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      await expect(getWorkspaceMembers("workspace1")).rejects.toThrow(
        "Mapping failed"
      );
    });
  });

  describe("edge cases", () => {
    test("should handle workspace with minimal owner data", async () => {
      const mockMembers = [];

      const mockWorkspace = {
        id: "workspace1",
        createdAt: new Date("2024-01-01"),
        owner: {
          id: "owner1",
          name: null,
          email: null,
          image: null,
          githubAuth: null,
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result.owner.user).toEqual({
        id: "owner1",
        name: null,
        email: null,
        image: null,
        github: null,
      });
    });

    test("should handle large member lists", async () => {
      // Create 100 mock members
      const mockMembers = Array.from({ length: 100 }, (_, i) => ({
        id: `member${i + 1}`,
        userId: `user${i + 1}`,
        role: i % 2 === 0 ? "DEVELOPER" : "PM",
        joinedAt: new Date(`2024-01-${String(i + 1).padStart(2, "0")}`),
        user: {
          id: `user${i + 1}`,
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`,
          image: null,
          githubAuth: null,
        },
      }));

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

      expect(result.members).toHaveLength(100);
      expect(result.owner).toBeDefined();
    });

    test("should handle workspace ID with special characters", async () => {
      const workspaceId = "workspace-123_test@example.com";
      const mockMembers = [];

      const mockWorkspace = {
        id: workspaceId,
        createdAt: new Date("2024-01-01"),
        owner: {
          id: "owner1",
          name: "Special Workspace Owner",
          email: "special@example.com",
          image: null,
          githubAuth: null,
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers(workspaceId);

      expect(mockedGetActiveWorkspaceMembers).toHaveBeenCalledWith(workspaceId);
      expect(result.owner.user.name).toBe("Special Workspace Owner");
    });
  });

  describe("data consistency", () => {
    test("should ensure owner ID consistency", async () => {
      const mockMembers = [];

      const mockWorkspace = {
        id: "workspace1",
        createdAt: new Date("2024-01-01"),
        owner: {
          id: "owner123",
          name: "Consistent Owner",
          email: "consistent@example.com",
          image: null,
          githubAuth: null,
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result.owner.id).toBe("owner123");
      expect(result.owner.userId).toBe("owner123");
      expect(result.owner.user.id).toBe("owner123");
    });

    test("should properly format joinedAt timestamp", async () => {
      const mockMembers = [];
      const createdDate = new Date("2024-06-15T14:30:00.000Z");

      const mockWorkspace = {
        id: "workspace1",
        createdAt: createdDate,
        owner: {
          id: "owner1",
          name: "Timestamp Owner",
          email: "timestamp@example.com",
          image: null,
          githubAuth: null,
        },
      };

      mockedGetActiveWorkspaceMembers.mockResolvedValue(mockMembers);
      mockedMapWorkspaceMembers.mockReturnValue(mockMembers);
      (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

      const result = await getWorkspaceMembers("workspace1");

      expect(result.owner.joinedAt).toBe("2024-06-15T14:30:00.000Z");
      expect(typeof result.owner.joinedAt).toBe("string");
    });

    test("should maintain correct role assignment", async () => {
      const mockMembers = [
        {
          id: "member1",
          userId: "user1",
          role: "ADMIN",
          joinedAt: new Date("2024-01-01"),
          user: {
            id: "user1",
            name: "Admin User",
            email: "admin@example.com",
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

      // Owner should always have OWNER role
      expect(result.owner.role).toBe("OWNER");
      
      // Regular members maintain their assigned roles
      expect(result.members[0].role).toBe("ADMIN");
    });
  });
});