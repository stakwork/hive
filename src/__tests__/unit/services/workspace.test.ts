import { describe, test, expect, beforeEach, vi, Mock } from "vitest";
import { WorkspaceRole } from "@prisma/client";
import { addWorkspaceMember } from "@/services/workspace";
import {
  findUserByGitHubUsername,
  findActiveMember,
  isWorkspaceOwner,
  findPreviousMember,
  createWorkspaceMember,
  reactivateWorkspaceMember,
} from "@/lib/helpers/workspace-member-queries";
import { mapWorkspaceMember } from "@/lib/mappers/workspace-member";

// Mock all helper functions
vi.mock("@/lib/helpers/workspace-member-queries", () => ({
  findUserByGitHubUsername: vi.fn(),
  findActiveMember: vi.fn(),
  isWorkspaceOwner: vi.fn(),
  findPreviousMember: vi.fn(),
  createWorkspaceMember: vi.fn(),
  reactivateWorkspaceMember: vi.fn(),
}));

vi.mock("@/lib/mappers/workspace-member", () => ({
  mapWorkspaceMember: vi.fn(),
}));

describe("addWorkspaceMember", () => {
  const mockWorkspaceId = "workspace-123";
  const mockGithubUsername = "testuser";
  const mockUserId = "user-456";
  const mockMemberId = "member-789";

  // Mock data factories
  const createMockGithubAuth = () => ({
    userId: mockUserId,
    githubUsername: mockGithubUsername,
  });

  const createMockPrismaMember = (role: WorkspaceRole, id = mockMemberId) => ({
    id,
    userId: mockUserId,
    workspaceId: mockWorkspaceId,
    role,
    joinedAt: new Date("2024-01-01"),
    leftAt: null,
    user: {
      id: mockUserId,
      name: "Test User",
      email: "test@example.com",
      image: "https://example.com/avatar.jpg",
      githubAuth: {
        githubUsername: mockGithubUsername,
        name: "Test User",
        bio: "Test bio",
        publicRepos: 10,
        followers: 100,
      },
    },
  });

  const createMockWorkspaceMember = (role: WorkspaceRole) => ({
    id: mockMemberId,
    userId: mockUserId,
    role,
    joinedAt: "2024-01-01T00:00:00.000Z",
    user: {
      id: mockUserId,
      name: "Test User",
      email: "test@example.com",
      image: "https://example.com/avatar.jpg",
      github: {
        username: mockGithubUsername,
        name: "Test User",
        bio: "Test bio",
        publicRepos: 10,
        followers: 100,
      },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy path - Create new member", () => {
    test("should successfully add a new member with VIEWER role", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.VIEWER);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.VIEWER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.VIEWER
      );

      expect(findUserByGitHubUsername).toHaveBeenCalledWith(mockGithubUsername);
      expect(findActiveMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(isWorkspaceOwner).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(findPreviousMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId,
        WorkspaceRole.VIEWER
      );
      expect(reactivateWorkspaceMember).not.toHaveBeenCalled();
      expect(mapWorkspaceMember).toHaveBeenCalledWith(mockPrismaMember);
      expect(result).toEqual(mockMappedMember);
    });

    test("should successfully add a new member with DEVELOPER role", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.DEVELOPER);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.DEVELOPER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.DEVELOPER
      );

      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId,
        WorkspaceRole.DEVELOPER
      );
      expect(result).toEqual(mockMappedMember);
      expect(result.role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should successfully add a new member with PM role", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.PM);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.PM);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.PM
      );

      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId,
        WorkspaceRole.PM
      );
      expect(result).toEqual(mockMappedMember);
      expect(result.role).toBe(WorkspaceRole.PM);
    });

    test("should successfully add a new member with ADMIN role", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.ADMIN);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.ADMIN);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.ADMIN
      );

      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId,
        WorkspaceRole.ADMIN
      );
      expect(result).toEqual(mockMappedMember);
      expect(result.role).toBe(WorkspaceRole.ADMIN);
    });
  });

  describe("Reactivation path - Soft-deleted member", () => {
    test("should reactivate a previously removed member", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPreviousMember = {
        id: "old-member-id",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.VIEWER,
        joinedAt: new Date("2023-01-01"),
        leftAt: new Date("2023-12-31"),
      };
      const mockReactivatedMember = createMockPrismaMember(WorkspaceRole.DEVELOPER, "old-member-id");
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.DEVELOPER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(mockPreviousMember);
      (reactivateWorkspaceMember as Mock).mockResolvedValue(mockReactivatedMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.DEVELOPER
      );

      expect(findPreviousMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(reactivateWorkspaceMember).toHaveBeenCalledWith(
        mockPreviousMember.id,
        WorkspaceRole.DEVELOPER
      );
      expect(createWorkspaceMember).not.toHaveBeenCalled();
      expect(mapWorkspaceMember).toHaveBeenCalledWith(mockReactivatedMember);
      expect(result).toEqual(mockMappedMember);
    });

    test("should reactivate with different role than previous membership", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPreviousMember = {
        id: "old-member-id",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.VIEWER,
        joinedAt: new Date("2023-01-01"),
        leftAt: new Date("2023-12-31"),
      };
      const mockReactivatedMember = createMockPrismaMember(WorkspaceRole.ADMIN, "old-member-id");
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.ADMIN);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(mockPreviousMember);
      (reactivateWorkspaceMember as Mock).mockResolvedValue(mockReactivatedMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.ADMIN
      );

      expect(reactivateWorkspaceMember).toHaveBeenCalledWith(
        mockPreviousMember.id,
        WorkspaceRole.ADMIN
      );
      expect(result.role).toBe(WorkspaceRole.ADMIN);
    });
  });

  describe("Error scenarios", () => {
    test("should throw error when user not found", async () => {
      (findUserByGitHubUsername as Mock).mockResolvedValue(null);

      await expect(
        addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.VIEWER)
      ).rejects.toThrow("User not found. They must sign up to Hive first.");

      expect(findUserByGitHubUsername).toHaveBeenCalledWith(mockGithubUsername);
      expect(findActiveMember).not.toHaveBeenCalled();
      expect(isWorkspaceOwner).not.toHaveBeenCalled();
      expect(createWorkspaceMember).not.toHaveBeenCalled();
      expect(reactivateWorkspaceMember).not.toHaveBeenCalled();
    });

    test("should throw error when user is already an active member", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockActiveMember = {
        id: mockMemberId,
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.DEVELOPER,
        joinedAt: new Date("2024-01-01"),
        leftAt: null,
      };

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(mockActiveMember);

      await expect(
        addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.VIEWER)
      ).rejects.toThrow("User is already a member of this workspace");

      expect(findUserByGitHubUsername).toHaveBeenCalledWith(mockGithubUsername);
      expect(findActiveMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(isWorkspaceOwner).not.toHaveBeenCalled();
      expect(createWorkspaceMember).not.toHaveBeenCalled();
      expect(reactivateWorkspaceMember).not.toHaveBeenCalled();
    });

    test("should throw error when user is the workspace owner", async () => {
      const mockGithubAuth = createMockGithubAuth();

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(true);

      await expect(
        addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.ADMIN)
      ).rejects.toThrow("Cannot add workspace owner as a member");

      expect(findUserByGitHubUsername).toHaveBeenCalledWith(mockGithubUsername);
      expect(findActiveMember).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(isWorkspaceOwner).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(createWorkspaceMember).not.toHaveBeenCalled();
      expect(reactivateWorkspaceMember).not.toHaveBeenCalled();
    });
  });

  describe("Return value validation", () => {
    test("should return correctly mapped WorkspaceMember DTO", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.DEVELOPER);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.DEVELOPER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.DEVELOPER
      );

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("userId");
      expect(result).toHaveProperty("role");
      expect(result).toHaveProperty("joinedAt");
      expect(result).toHaveProperty("user");
      expect(result.user).toHaveProperty("id");
      expect(result.user).toHaveProperty("name");
      expect(result.user).toHaveProperty("email");
      expect(result.user).toHaveProperty("image");
      expect(result.user).toHaveProperty("github");
    });

    test("should map member with correct user data including GitHub profile", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.PM);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.PM);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      const result = await addWorkspaceMember(
        mockWorkspaceId,
        mockGithubUsername,
        WorkspaceRole.PM
      );

      expect(result.user.github).toBeDefined();
      expect(result.user.github?.username).toBe(mockGithubUsername);
      expect(result.user.github?.name).toBe("Test User");
      expect(result.user.github?.bio).toBe("Test bio");
      expect(result.user.github?.publicRepos).toBe(10);
      expect(result.user.github?.followers).toBe(100);
    });
  });

  describe("Helper function call verification", () => {
    test("should call all validation helpers in correct order for new member", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.VIEWER);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.VIEWER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      await addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.VIEWER);

      expect(findUserByGitHubUsername).toHaveBeenCalledBefore(findActiveMember as Mock);
      expect(findActiveMember).toHaveBeenCalledBefore(isWorkspaceOwner as Mock);
      expect(isWorkspaceOwner).toHaveBeenCalledBefore(findPreviousMember as Mock);
      expect(findPreviousMember).toHaveBeenCalledBefore(createWorkspaceMember as Mock);
    });

    test("should extract userId from githubAuth result", async () => {
      const mockGithubAuth = { userId: "custom-user-id", githubUsername: mockGithubUsername };
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.DEVELOPER);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.DEVELOPER);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      await addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.DEVELOPER);

      expect(findActiveMember).toHaveBeenCalledWith(mockWorkspaceId, "custom-user-id");
      expect(isWorkspaceOwner).toHaveBeenCalledWith(mockWorkspaceId, "custom-user-id");
      expect(findPreviousMember).toHaveBeenCalledWith(mockWorkspaceId, "custom-user-id");
      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        "custom-user-id",
        WorkspaceRole.DEVELOPER
      );
    });

    test("should pass correct parameters to createWorkspaceMember", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPrismaMember = createMockPrismaMember(WorkspaceRole.PM);
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.PM);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(null);
      (createWorkspaceMember as Mock).mockResolvedValue(mockPrismaMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      await addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.PM);

      expect(createWorkspaceMember).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId,
        WorkspaceRole.PM
      );
      expect(createWorkspaceMember).toHaveBeenCalledTimes(1);
    });

    test("should pass correct parameters to reactivateWorkspaceMember", async () => {
      const mockGithubAuth = createMockGithubAuth();
      const mockPreviousMember = {
        id: "previous-member-id",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.VIEWER,
        joinedAt: new Date("2023-01-01"),
        leftAt: new Date("2023-12-31"),
      };
      const mockReactivatedMember = createMockPrismaMember(WorkspaceRole.ADMIN, "previous-member-id");
      const mockMappedMember = createMockWorkspaceMember(WorkspaceRole.ADMIN);

      (findUserByGitHubUsername as Mock).mockResolvedValue(mockGithubAuth);
      (findActiveMember as Mock).mockResolvedValue(null);
      (isWorkspaceOwner as Mock).mockResolvedValue(false);
      (findPreviousMember as Mock).mockResolvedValue(mockPreviousMember);
      (reactivateWorkspaceMember as Mock).mockResolvedValue(mockReactivatedMember);
      (mapWorkspaceMember as Mock).mockReturnValue(mockMappedMember);

      await addWorkspaceMember(mockWorkspaceId, mockGithubUsername, WorkspaceRole.ADMIN);

      expect(reactivateWorkspaceMember).toHaveBeenCalledWith(
        "previous-member-id",
        WorkspaceRole.ADMIN
      );
      expect(reactivateWorkspaceMember).toHaveBeenCalledTimes(1);
    });
  });
});
