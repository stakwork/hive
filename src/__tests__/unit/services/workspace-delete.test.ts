import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
    swarm: {
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

vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

// Test data
const mockUserId = "user-123";
const mockWorkspaceId = "workspace-123";
const mockSlug = "test-workspace";
const mockSwarmId = "swarm-123";
const mockEc2Id = "i-1234567890abcdef0";
const mockPoolName = mockSwarmId;
const mockSwarmName = "test-swarm";
const mockDecryptedApiKey = "decrypted-pool-api-key";
const mockAdminToken = "admin-auth-token";

const mockWorkspaceDbRecord = {
  id: mockWorkspaceId,
  name: "Test Workspace",
  slug: mockSlug,
  description: "Test Description",
  ownerId: mockUserId,
  deleted: false,
  deletedAt: null,
  originalSlug: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  logoUrl: null,
  logoKey: null,
  sourceControlOrgId: null,
  stakworkApiKey: null,
  mission: null,
  nodeTypeOrder: null,
  repositoryDraft: null,
  owner: {
    id: mockUserId,
    name: "Test Owner",
    email: "owner@test.com",
  },
  swarm: null,
  repositories: [],
};

const mockSwarmWithAllResources = {
  id: mockSwarmId,
  name: mockSwarmName,
  poolApiKey: "encrypted-pool-api-key",
  ec2Id: mockEc2Id,
};

describe("deleteWorkspaceBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env.POOL_MANAGER_BASE_URL = "https://workspaces.sphinx.chat/api";
    process.env.POOL_MANAGER_API_USERNAME = "admin";
    process.env.POOL_MANAGER_API_PASSWORD = "password";

    // Setup default fetch mock
    global.fetch = vi.fn();
  });

  describe("Authorization", () => {
    it("should successfully delete workspace when user is OWNER", async () => {
      // Arrange - Mock getWorkspaceBySlug internals
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null); // Not a member, is owner
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null); // No swarm
      
      // Mock softDeleteWorkspace internals
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { slug: mockSlug, deleted: false },
      }));
      expect(db.workspace.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: mockWorkspaceId },
        data: expect.objectContaining({
          deleted: true,
          originalSlug: mockSlug,
        }),
      }));
    });

    it("should throw error when workspace not found", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

      // Act & Assert
      await expect(
        deleteWorkspaceBySlug(mockSlug, mockUserId)
      ).rejects.toThrow("Workspace not found or access denied");
    });

    it("should throw error when user is not OWNER (ADMIN role)", async () => {
      // Arrange - User is ADMIN member
      const adminWorkspace = { ...mockWorkspaceDbRecord, ownerId: "different-user" };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(adminWorkspace);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue({
        id: "member-1",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: "ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      });

      // Act & Assert
      await expect(
        deleteWorkspaceBySlug(mockSlug, mockUserId)
      ).rejects.toThrow("Only workspace owners can delete workspaces");
    });
  });

  describe("Cascading Deletes - Workspace without Swarm", () => {
    it("should soft-delete workspace when no swarm exists", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: mockWorkspaceId },
        data: expect.objectContaining({
          deleted: true,
        }),
      }));
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("Cascading Deletes - Pool Manager Integration", () => {
    it("should continue deletion when pool API returns 401 (invalid/expired key)", async () => {
      // Arrange
      const swarmWithPool = { ...mockSwarmWithAllResources, ec2Id: null, name: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);
      
      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);
      
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should skip pool deletion when poolApiKey is null", async () => {
      // Arrange
      const swarmWithoutPool = { id: mockSwarmId, name: null, poolApiKey: null, ec2Id: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithoutPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(global.fetch).not.toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });
  });

  describe("Cascading Deletes - EC2 Instance Integration", () => {
    it("should delete EC2 instance when ec2Id exists and deletion succeeds", async () => {
      // Arrange
      const swarmWithEc2 = { ...mockSwarmWithAllResources, poolApiKey: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithEc2);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(getServiceConfig).toHaveBeenCalledWith("swarm");
      expect(SwarmService).toHaveBeenCalled();
      expect(mockSwarmService.stopSwarm).toHaveBeenCalledWith({
        instance_id: mockEc2Id,
      });
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when EC2 deletion fails with error", async () => {
      // Arrange
      const swarmWithEc2 = { ...mockSwarmWithAllResources, poolApiKey: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithEc2);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockRejectedValue(new Error("EC2 API error")),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockSwarmService.stopSwarm).toHaveBeenCalledWith({
        instance_id: mockEc2Id,
      });
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion even when EC2 deletion returns failure response", async () => {
      // Arrange
      const swarmWithEc2 = { ...mockSwarmWithAllResources, poolApiKey: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithEc2);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockResolvedValue({ success: false }),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act - Should not throw, should continue with workspace deletion
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockSwarmService.stopSwarm).toHaveBeenCalledWith({
        instance_id: mockEc2Id,
      });
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should skip EC2 deletion when ec2Id is null", async () => {
      // Arrange
      const swarmWithoutEc2 = { id: mockSwarmId, name: null, poolApiKey: null, ec2Id: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithoutEc2);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(SwarmService).not.toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });
  });
});
