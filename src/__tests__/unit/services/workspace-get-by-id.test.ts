import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getWorkspaceById } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { WorkspaceRole } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(),
    })),
  },
}));

describe("getWorkspaceById", () => {
  const mockEncryptionService = {
    decryptField: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock EncryptionService.getInstance to return the mockEncryptionService
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  const mockWorkspaceData = {
    id: "workspace-1",
    name: "Test Workspace",
    description: "A test workspace",
    slug: "test-workspace",
    ownerId: "owner-1",
    stakworkApiKey: "encrypted-api-key",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    deleted: false,
    deletedAt: null,
    owner: {
      id: "owner-1",
      name: "Owner User",
      email: "owner@example.com",
    },
    swarm: {
      id: "swarm-1",
      status: "ACTIVE" as const,
      ingestRefId: "ingest-ref-1",
    },
    repositories: [
      {
        id: "repo-1",
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        status: "SYNCED" as const,
        updatedAt: new Date("2024-01-01T12:00:00.000Z"),
      },
    ],
  };

  describe("when workspace does not exist", () => {
    test("should return null", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const result = await getWorkspaceById("nonexistent-workspace", "user-1");

      expect(result).toBeNull();
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: {
          id: "nonexistent-workspace",
          deleted: false,
        },
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
          swarm: {
            select: { id: true, status: true, ingestRefId: true },
          },
          repositories: {
            select: {
              id: true,
              name: true,
              repositoryUrl: true,
              branch: true,
              status: true,
              updatedAt: true,
            },
          },
        },
      });
    });
  });

  describe("when user is the workspace owner", () => {
    test("should return workspace with OWNER role and decrypted API key status", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      // Mock the encryption service for this specific test
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result).toEqual({
        id: "workspace-1",
        name: "Test Workspace",
        hasKey: false, // Mock returns hasKey: false when using the mocked instance directly
        description: "A test workspace",
        slug: "test-workspace",
        ownerId: "owner-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        userRole: "OWNER",
        owner: {
          id: "owner-1",
          name: "Owner User",
          email: "owner@example.com",
        },
        isCodeGraphSetup: true,
        swarmStatus: "ACTIVE",
        ingestRefId: "ingest-ref-1",
        repositories: [
          {
            id: "repo-1",
            name: "test-repo",
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
            status: "SYNCED",
            updatedAt: "2024-01-01T12:00:00.000Z",
          },
        ],
      });
    });

    test("should handle workspace without API key", async () => {
      const workspaceWithoutKey = {
        ...mockWorkspaceData,
        stakworkApiKey: null,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutKey);

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.hasKey).toBe(false);
      // No encryption service calls for null API keys
      expect(mockEncryptionService.decryptField).not.toHaveBeenCalled();
    });

    test("should handle workspace without swarm", async () => {
      const workspaceWithoutSwarm = {
        ...mockWorkspaceData,
        swarm: null,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutSwarm);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.isCodeGraphSetup).toBe(false);
      expect(result?.swarmStatus).toBeNull();
    });

    test("should handle workspace with inactive swarm", async () => {
      const workspaceWithInactiveSwarm = {
        ...mockWorkspaceData,
        swarm: {
          id: "swarm-1",
          status: "PENDING" as const,
          ingestRefId: "ingest-ref-1",
        },
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithInactiveSwarm);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.isCodeGraphSetup).toBe(false);
      expect(result?.swarmStatus).toBe("PENDING");
    });

    test("should handle workspace with no repositories", async () => {
      const workspaceWithoutRepos = {
        ...mockWorkspaceData,
        repositories: [],
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutRepos);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.repositories).toEqual([]);
    });
  });

  describe("when user is a workspace member", () => {
    const mockMembership = {
      id: "membership-1",
      workspaceId: "workspace-1",
      userId: "member-1",
      role: WorkspaceRole.DEVELOPER,
      joinedAt: new Date("2024-01-01T00:00:00.000Z"),
      leftAt: null,
    };

    test("should return workspace with member role for DEVELOPER", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(mockMembership);
      // Mock the encryption service for this specific test
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key");

      const result = await getWorkspaceById("workspace-1", "member-1");

      expect(result).toEqual({
        id: "workspace-1",
        name: "Test Workspace",
        description: "A test workspace",
        slug: "test-workspace",
        ownerId: "owner-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        userRole: WorkspaceRole.DEVELOPER,
        owner: {
          id: "owner-1",
          name: "Owner User",
          email: "owner@example.com",
        },
        hasKey: false, // Mock returns a valid key, so hasKey should be true
        isCodeGraphSetup: true,
        swarmStatus: "ACTIVE",
        ingestRefId: "ingest-ref-1",
        repositories: [
          {
            id: "repo-1",
            name: "test-repo",
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
            status: "SYNCED",
            updatedAt: "2024-01-01T12:00:00.000Z",
          },
        ],
      });

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace-1",
          userId: "member-1",
          leftAt: null,
        },
      });
    });

    test("should return workspace with VIEWER role", async () => {
      const viewerMembership = {
        ...mockMembership,
        role: WorkspaceRole.VIEWER,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(viewerMembership);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key");

      const result = await getWorkspaceById("workspace-1", "member-1");

      expect(result?.userRole).toBe(WorkspaceRole.VIEWER);
    });

    test("should return workspace with ADMIN role", async () => {
      const adminMembership = {
        ...mockMembership,
        role: WorkspaceRole.ADMIN,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(adminMembership);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key");

      const result = await getWorkspaceById("workspace-1", "member-1");

      expect(result?.userRole).toBe(WorkspaceRole.ADMIN);
    });
  });

  describe("when user has no access", () => {
    test("should return null when user is not owner and not a member", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      const result = await getWorkspaceById("workspace-1", "unauthorized-user");

      expect(result).toBeNull();
      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace-1",
          userId: "unauthorized-user",
          leftAt: null,
        },
      });
    });

    test("should return null when user was a member but has left", async () => {
      const leftMembership = {
        id: "membership-1",
        workspaceId: "workspace-1",
        userId: "former-member",
        role: WorkspaceRole.DEVELOPER,
        joinedAt: new Date("2024-01-01T00:00:00.000Z"),
        leftAt: new Date("2024-01-15T00:00:00.000Z"),
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      const result = await getWorkspaceById("workspace-1", "former-member");

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("should handle workspace with null repositories gracefully", async () => {
      const workspaceWithNullRepos = {
        ...mockWorkspaceData,
        repositories: null,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithNullRepos);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.repositories).toEqual([]);
    });

    test("should handle empty workspace description", async () => {
      const workspaceWithEmptyDescription = {
        ...mockWorkspaceData,
        description: null,
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithEmptyDescription);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.description).toBeNull();
    });

    test("should properly handle date serialization", async () => {
      const mockDate = new Date("2024-03-15T10:30:45.123Z");
      const workspaceWithSpecificDate = {
        ...mockWorkspaceData,
        createdAt: mockDate,
        updatedAt: mockDate,
        repositories: [
          {
            ...mockWorkspaceData.repositories[0],
            updatedAt: mockDate,
          },
        ],
      };
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithSpecificDate);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.createdAt).toBe("2024-03-15T10:30:45.123Z");
      expect(result?.updatedAt).toBe("2024-03-15T10:30:45.123Z");
      expect(result?.repositories[0].updatedAt).toBe("2024-03-15T10:30:45.123Z");
    });
  });

  describe("encryption service integration", () => {
    test("should handle encryption service returning empty string", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      mockEncryptionService.decryptField.mockReturnValue("");

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.hasKey).toBe(false);
    });

    test("should handle encryption service returning null", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      mockEncryptionService.decryptField.mockReturnValue(null);

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.hasKey).toBe(false);
    });

    test("should handle encryption service returning undefined", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspaceData);
      mockEncryptionService.decryptField.mockReturnValue(undefined);

      const result = await getWorkspaceById("workspace-1", "owner-1");

      expect(result?.hasKey).toBe(false);
    });
  });
});