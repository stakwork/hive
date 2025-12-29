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
  let mockEncryptionInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env.POOL_MANAGER_BASE_URL = "https://workspaces.sphinx.chat/api";
    process.env.POOL_MANAGER_API_USERNAME = "admin";
    process.env.POOL_MANAGER_API_PASSWORD = "password";

    // Setup default fetch mock
    global.fetch = vi.fn();

    // Setup default encryption service mock that returns the same instance
    mockEncryptionInstance = {
      decryptField: vi.fn().mockReturnValue(mockDecryptedApiKey),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionInstance as any);
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
    it("should successfully delete pool when API returns 200 OK", async () => {
      // Arrange
      const swarmWithPool = { ...mockSwarmWithAllResources, ec2Id: null, name: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);
      
      // Reset default mock and setup new one specifically for this test
      vi.mocked(EncryptionService.getInstance).mockClear();
      const mockEncryptionInstance = {
        decryptField: vi.fn().mockReturnValue(mockDecryptedApiKey),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionInstance as any);
      
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockEncryptionInstance.decryptField).toHaveBeenCalledWith("poolApiKey", swarmWithPool.poolApiKey);
      expect(global.fetch).toHaveBeenCalledWith(
        `${process.env.POOL_MANAGER_BASE_URL}/pools/${mockPoolName}`,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockDecryptedApiKey}`,
            "Content-Type": "application/json",
          }),
        })
      );
      expect(db.workspace.update).toHaveBeenCalled();
    });

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

    it("should continue deletion when pool API returns 404 (pool not found)", async () => {
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
        status: 404,
      } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when pool API returns other error status", async () => {
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
        status: 500,
      } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when decryption returns empty string", async () => {
      // Arrange
      const swarmWithPool = { ...mockSwarmWithAllResources, ec2Id: null, name: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);
      
      // Reset and create new mock
      vi.mocked(EncryptionService.getInstance).mockClear();
      const mockEncryptionInstance = {
        decryptField: vi.fn().mockReturnValue(""),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionInstance as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockEncryptionInstance.decryptField).toHaveBeenCalledWith("poolApiKey", swarmWithPool.poolApiKey);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when decryption returns null", async () => {
      // Arrange
      const swarmWithPool = { ...mockSwarmWithAllResources, ec2Id: null, name: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);
      
      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(null as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(global.fetch).not.toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when pool deletion fetch throws network error", async () => {
      // Arrange
      const swarmWithPool = { ...mockSwarmWithAllResources, ec2Id: null, name: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);
      
      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);
      
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

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

  describe("Cascading Deletes - Pool User Deletion", () => {
    it("should successfully delete pool user when authentication succeeds", async () => {
      // Arrange - Pool user deletion requires BOTH poolApiKey and name
      const swarmWithNameAndPool = { 
        id: mockSwarmId, 
        name: mockSwarmName, 
        poolApiKey: "encrypted-pool-api-key", 
        ec2Id: null 
      };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameAndPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Mock encryption for pool deletion
      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      // Mock pool deletion, then auth, then user deletion
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenNthCalledWith(2, 
        `${process.env.POOL_MANAGER_BASE_URL}/auth/login`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            username: process.env.POOL_MANAGER_API_USERNAME,
            password: process.env.POOL_MANAGER_API_PASSWORD,
          }),
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(3,
        `${process.env.POOL_MANAGER_BASE_URL}/users/${mockSwarmName}`,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAdminToken}`,
          }),
        })
      );
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when pool user not found (404)", async () => {
      // Arrange
      const swarmWithNameAndPool = { 
        id: mockSwarmId, 
        name: mockSwarmName, 
        poolApiKey: "encrypted-pool-api-key", 
        ec2Id: null 
      };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameAndPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when Pool Manager authentication fails", async () => {
      // Arrange
      const swarmWithNameAndPool = { 
        id: mockSwarmId, 
        name: mockSwarmName, 
        poolApiKey: "encrypted-pool-api-key", 
        ec2Id: null 
      };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameAndPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when Pool Manager auth returns no token", async () => {
      // Arrange
      const swarmWithNameAndPool = { 
        id: mockSwarmId, 
        name: mockSwarmName, 
        poolApiKey: "encrypted-pool-api-key", 
        ec2Id: null 
      };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameAndPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: false }),
        } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when pool user deletion throws network error", async () => {
      // Arrange
      const swarmWithNameAndPool = { 
        id: mockSwarmId, 
        name: mockSwarmName, 
        poolApiKey: "encrypted-pool-api-key", 
        ec2Id: null 
      };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameAndPool);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        .mockRejectedValueOnce(new Error("Network timeout"));

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should skip pool user deletion when swarm name is null", async () => {
      // Arrange
      const swarmWithoutName = { id: mockSwarmId, name: null, poolApiKey: "encrypted-key", ec2Id: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithoutName);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Use default encryption mock from beforeEach

      // Pool deletion will be called
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert - Only pool deletion should be called, not user deletion
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `${process.env.POOL_MANAGER_BASE_URL}/pools/${mockSwarmId}`,
        expect.any(Object)
      );
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should skip both pool and pool user deletion when poolApiKey is null", async () => {
      // Arrange - When poolApiKey is null, entire block is skipped regardless of name
      const swarmWithNameOnly = { id: mockSwarmId, name: mockSwarmName, poolApiKey: null, ec2Id: null };
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(swarmWithNameOnly);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert - No fetch calls should be made
      expect(global.fetch).not.toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });
  });

  describe("Cascading Deletes - Combined Scenarios", () => {
    it("should delete both pool and EC2 when both exist", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarmWithAllResources);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      // Mock pool deletion
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        // Mock pool user auth
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        // Mock pool user deletion
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(encryptionService.decryptField).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(mockSwarmService.stopSwarm).toHaveBeenCalledWith({ instance_id: mockEc2Id });
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when pool fails but EC2 succeeds", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarmWithAllResources);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      // Mock pool deletion failure
      vi.mocked(global.fetch)
        .mockRejectedValueOnce(new Error("Pool deletion failed"))
        // Pool user auth succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        // Pool user deletion succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockSwarmService.stopSwarm).toHaveBeenCalledWith({ instance_id: mockEc2Id });
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should continue deletion when EC2 fails but pool succeeds", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarmWithAllResources);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      // Mock pool deletion success
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        // Pool user auth
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, token: mockAdminToken }),
        } as Response)
        // Pool user deletion
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response);

      const mockSwarmService = {
        stopSwarm: vi.fn().mockRejectedValue(new Error("EC2 deletion failed")),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(mockSwarmService.stopSwarm).toHaveBeenCalled();
      expect(db.workspace.update).toHaveBeenCalled();
    });

    it("should complete deletion even when all external resources fail", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarmWithAllResources);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      const encryptionService = EncryptionService.getInstance();
      vi.mocked(encryptionService.decryptField).mockReturnValue(mockDecryptedApiKey);

      // All external calls fail
      vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

      const mockSwarmService = {
        stopSwarm: vi.fn().mockRejectedValue(new Error("EC2 API error")),
      };
      vi.mocked(SwarmService).mockImplementation(() => mockSwarmService as any);
      vi.mocked(getServiceConfig).mockReturnValue({} as any);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert - Workspace should still be soft-deleted
      expect(db.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockWorkspaceId },
          data: expect.objectContaining({
            deleted: true,
            originalSlug: mockSlug,
          }),
        })
      );
    });
  });

  describe("Soft Delete Logic", () => {
    it("should modify slug with timestamp when soft deleting", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockWorkspaceId },
          data: expect.objectContaining({
            deleted: true,
            deletedAt: expect.any(Date),
            originalSlug: mockSlug,
            slug: expect.stringMatching(new RegExp(`^${mockSlug}-deleted-\\d+$`)),
          }),
        })
      );
    });

    it("should store originalSlug for potential recovery", async () => {
      // Arrange
      vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspaceDbRecord);
      vi.mocked(db.workspace.update).mockResolvedValue(mockWorkspaceDbRecord);

      // Act
      await deleteWorkspaceBySlug(mockSlug, mockUserId);

      // Assert
      expect(db.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originalSlug: mockSlug,
          }),
        })
      );
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
