import { POST } from "@/app/api/swarm/route";
import { getServiceConfig } from "@/config/services";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { SwarmStatus, RepositoryStatus } from "@prisma/client";
import { auth } from "@/lib/auth/auth";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, Mock, test, vi } from "vitest";
import { randomUUID } from "crypto";

// Mock external dependencies
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

    mockGenerateSecurePassword.mockReturnValue("secure-test-password-123");
    mockRandomUUID.mockReturnValue("temp-uuid-123");

    // Setup default database transaction mock
    mockDb.$transaction.mockImplementation(async (callback) => {
      return callback({
        swarm: mockDb.swarm,
        repository: mockDb.repository,
      });
    });

    // Default database mocks
    mockDb.workspace.findUnique.mockResolvedValue({
      id: "workspace-123",
      slug: "test-workspace",
      sourceControlOrg: null, // No existing linkage
    });
    mockDb.sourceControlOrg.findUnique.mockResolvedValue({
      id: "source-control-org-123",
      githubLogin: "test",
      githubInstallationId: 12345,
    });
    mockDb.workspace.update.mockResolvedValue({
      id: "workspace-123",
      sourceControlOrgId: "source-control-org-123",
    });

    mockDb.swarm.findFirst.mockResolvedValue(null); // No existing swarm
    mockDb.swarm.create.mockResolvedValue({
      id: "placeholder-swarm-123",
      workspaceId: "workspace-123",
      name: "temp-uuid-123",
      status: SwarmStatus.PENDING,
    });
    mockDb.swarm.update.mockResolvedValue({
      id: "placeholder-swarm-123",
      workspaceId: "workspace-123",
      name: "swarm2bCar4",
      status: SwarmStatus.ACTIVE,
      swarmId: "swarm2bCar4",
    });
    mockDb.repository.create.mockResolvedValue({
      id: "repo-123",
      name: "test-repo",
      repositoryUrl: "https://github.com/test/repo",
      status: RepositoryStatus.PENDING,
    });
  });

  const createMockRequest = (body: object) => {
    return new NextRequest("http://localhost:3000/api/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const validSwarmData = {
    workspaceId: "workspace-123",
    name: "test-swarm",
    repositoryName: "test-repo",
    repositoryUrl: "https://github.com/test/repo",
    repositoryDescription: "Test repository",
    repositoryDefaultBranch: "main",
  };

  describe("Authentication and Authorization", () => {
    test("should reject unauthenticated requests", async () => {
      mockAuth.mockResolvedValue(null);

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        success: false,
        message: "Unauthorized",
      });

      // Verify no sensitive operations were attempted
      expect(mockValidateWorkspaceAccessById).not.toHaveBeenCalled();
      expect(mockGenerateSecurePassword).not.toHaveBeenCalled();
      expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    test("should reject users without workspace access", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: false,
        canAdmin: false,
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        success: false,
        message: "Workspace not found or access denied",
      });

      // Verify sensitive operations were blocked
      expect(mockGenerateSecurePassword).not.toHaveBeenCalled();
      expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    test("should reject users without admin permissions", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: false,
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        success: false,
        message: "Only workspace owners and admins can create swarms",
      });

      // Verify sensitive operations were blocked
      expect(mockGenerateSecurePassword).not.toHaveBeenCalled();
      expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    test("should allow workspace owners and admins", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "sensitive-api-key-789",
          ec2_id: "i-1234567890abcdef0",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Swarm was created successfully",
        data: {
          id: "placeholder-swarm-123",
          swarmId: "swarm2bCar4",
        },
      });
      expect(mockValidateWorkspaceAccessById).toHaveBeenCalledWith(
        "workspace-123",
        "user-123"
      );
    });
  });

  describe("Input Validation", () => {
    test("should reject requests with missing workspaceId", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      const invalidData = { ...validSwarmData };
      delete (invalidData as any).workspaceId;

      const request = createMockRequest(invalidData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: workspaceId, repositoryUrl");
    });

    test("should reject requests with missing repository fields", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      const invalidData = {
        workspaceId: "workspace-123",
        name: "test-swarm",
      };

      const request = createMockRequest(invalidData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: workspaceId, repositoryUrl");
    });
  });

  describe("Sensitive Data Handling", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });
    });

    test("should generate secure password for swarm", async () => {
      mockSaveOrUpdateSwarm.mockResolvedValue({ id: "final-swarm", swarmId: "swarm2bCar4" });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "sensitive-api-key-789",
        },
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);

      expect(mockGenerateSecurePassword).toHaveBeenCalledWith(20);

      // Verify password was used in swarm creation
      expect(mockSwarmServiceInstance.createSwarm).toHaveBeenCalledWith({
        instance_type: "m6i.xlarge",
        password: "secure-test-password-123",
      });
    });

    test("should handle API key securely", async () => {
      const sensitiveApiKey = "very-sensitive-api-key-123";

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: sensitiveApiKey,
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify API key is not exposed in response
      expect(JSON.stringify(data)).not.toContain(sensitiveApiKey);
      expect(data.data).toEqual({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      // Verify API key was saved to database securely via saveOrUpdateSwarm (which encrypts)
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-123",
          swarmApiKey: sensitiveApiKey,
          swarmPassword: "secure-test-password-123",
        })
      );
    });

    test("should create secure secret alias", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);

      // Verify secret alias was created correctly via saveOrUpdateSwarm
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmSecretAlias: "{{swarm2bCar4_API_KEY}}",
        })
      );
    });
  });

  describe("Existing Swarm Handling", () => {
    test("should return existing swarm if one already exists", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Mock existing swarm found in transaction
      const existingSwarm = {
        id: "existing-swarm-123",
        swarmId: "existing-swarm-id",
        status: SwarmStatus.ACTIVE,
      };
      mockDb.$transaction.mockResolvedValue({
        exists: true,
        swarm: existingSwarm,
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Swarm already exists for this workspace",
        data: {
          id: "existing-swarm-123",
          swarmId: "existing-swarm-id",
        },
      });

      // Should not call external service if swarm exists
      expect(mockSwarmServiceInstance.createSwarm).not.toHaveBeenCalled();
    });
  });

  describe("External Service Integration", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });
    });

    test("should handle external service errors gracefully", async () => {
      const serviceError = new Error("External service unavailable");
      (serviceError as any).status = 503;
      serviceError.message = "Service temporarily unavailable";

      mockSwarmServiceInstance.createSwarm.mockRejectedValue(serviceError);

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Service temporarily unavailable");

      // Verify placeholder swarm was marked as FAILED
      expect(mockDb.swarm.update).toHaveBeenCalledWith({
        where: { id: "placeholder-swarm-123" },
        data: {
          status: SwarmStatus.FAILED,
        },
      });

      // Verify saveOrUpdateSwarm was not called on error
      expect(mockSaveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    test("should handle unknown errors securely", async () => {
      const unknownError = new Error("Internal error with sensitive info: api-key-secret-123");
      mockSwarmServiceInstance.createSwarm.mockRejectedValue(unknownError);

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unknown error while creating swarm");

      // Verify sensitive info from error is not exposed
      expect(JSON.stringify(data)).not.toContain("api-key-secret-123");

      // Verify placeholder was marked as FAILED
      expect(mockDb.swarm.update).toHaveBeenCalledWith({
        where: { id: "placeholder-swarm-123" },
        data: {
          status: SwarmStatus.FAILED,
        },
      });
    });

    test("should handle malformed external service responses", async () => {
      // Malformed response missing required fields
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          // Missing swarm_id, address, x_api_key
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200); // Should still succeed

      // Verify it handles undefined values gracefully via saveOrUpdateSwarm
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-123",
          name: undefined, // undefined swarm_id
          swarmUrl: "https://undefined/api", // undefined address becomes "undefined"
          swarmApiKey: undefined,
          swarmSecretAlias: undefined, // undefined swarm_id results in undefined
        })
      );
    });
  });

  describe("Workspace SourceControlOrg Linking", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });
    });

    test("should link workspace to existing SourceControlOrg", async () => {
      // Workspace without existing linkage
      mockDb.workspace.findUnique.mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        sourceControlOrg: null,
      });

      // Existing SourceControlOrg found
      mockDb.sourceControlOrg.findUnique.mockResolvedValue({
        id: "source-control-org-123",
        githubLogin: "test",
        githubInstallationId: 12345,
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify workspace was linked to SourceControlOrg
      expect(mockDb.workspace.update).toHaveBeenCalledWith({
        where: { id: "workspace-123" },
        data: { sourceControlOrgId: "source-control-org-123" },
      });

      // Verify GitHub owner extraction from repository URL
      expect(mockDb.sourceControlOrg.findUnique).toHaveBeenCalledWith({
        where: { githubLogin: "test" },
      });
    });

    test("should skip linking if workspace already has SourceControlOrg", async () => {
      // Workspace with existing linkage
      mockDb.workspace.findUnique.mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        sourceControlOrg: {
          id: "existing-org-123",
          githubLogin: "test",
          githubInstallationId: 12345,
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify no linking attempted since workspace already linked
      expect(mockDb.sourceControlOrg.findUnique).not.toHaveBeenCalled();
      expect(mockDb.workspace.update).not.toHaveBeenCalled();
    });

    test("should handle case where no SourceControlOrg exists for GitHub owner", async () => {
      // Workspace without existing linkage
      mockDb.workspace.findUnique.mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        sourceControlOrg: null,
      });

      // No SourceControlOrg found for this GitHub owner
      mockDb.sourceControlOrg.findUnique.mockResolvedValue(null);

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify GitHub owner lookup was attempted
      expect(mockDb.sourceControlOrg.findUnique).toHaveBeenCalledWith({
        where: { githubLogin: "test" },
      });

      // Verify no linking happened since no SourceControlOrg exists
      expect(mockDb.workspace.update).not.toHaveBeenCalled();
    });

    test("should handle invalid GitHub repository URL", async () => {
      // Workspace without existing linkage
      mockDb.workspace.findUnique.mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        sourceControlOrg: null,
      });

      const invalidRepoData = {
        ...validSwarmData,
        repositoryUrl: "https://gitlab.com/test/repo", // Not GitHub
      };

      const request = createMockRequest(invalidRepoData);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify no GitHub owner lookup since URL is invalid
      expect(mockDb.sourceControlOrg.findUnique).not.toHaveBeenCalled();
      expect(mockDb.workspace.update).not.toHaveBeenCalled();
    });
  });

  describe("Database Operations", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });
    });

    test("should create placeholder swarm then update after successful service creation", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
          ec2_id: "i-1234567890abcdef0",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);

      // Verify transaction was called to create placeholder
      expect(mockDb.$transaction).toHaveBeenCalled();

      // Verify placeholder was updated with real data via saveOrUpdateSwarm (with encryption)
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-123",
        name: "swarm2bCar4", // Uses swarm_id as name
        status: SwarmStatus.ACTIVE,
        swarmUrl: "https://swarm2bCar4.sphinx.chat/api",
        ec2Id: "i-1234567890abcdef0",
        swarmApiKey: "api-key-123",
        swarmSecretAlias: "{{swarm2bCar4_API_KEY}}",
        swarmId: "swarm2bCar4",
        swarmPassword: "secure-test-password-123",
      });
    });

    test("should create repository record during transaction", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      const requestData = {
        ...validSwarmData,
        repositoryName: "custom-repo-name",
        repositoryDefaultBranch: "develop",
      };

      const request = createMockRequest(requestData);

      // Setup transaction to verify repository creation
      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          swarm: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
              id: "placeholder-swarm-123",
              status: SwarmStatus.PENDING,
            }),
          },
          repository: {
            create: vi.fn().mockResolvedValue({
              id: "repo-123",
              name: "custom-repo-name",
            }),
          },
        };

        const result = await callback(mockTx);

        // Verify repository was created with correct data
        expect(mockTx.repository.create).toHaveBeenCalledWith({
          data: {
            name: "custom-repo-name",
            repositoryUrl: "https://github.com/test/repo",
            branch: "develop",
            workspaceId: "workspace-123",
            status: RepositoryStatus.PENDING,
          },
        });

        return result;
      });

      await POST(request);
    });

    test("should handle database update failure after service creation", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });
      mockSaveOrUpdateSwarm.mockRejectedValue(new Error("Database connection failed"));

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unknown error while creating swarm");
    });

    test("should handle transaction failure during placeholder creation", async () => {
      mockDb.$transaction.mockRejectedValue(new Error("Transaction failed"));

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unknown error while creating swarm");

      // Verify external service was not called if transaction failed
      expect(mockSwarmServiceInstance.createSwarm).not.toHaveBeenCalled();
    });
  });

  describe("Data Flow and State Management", () => {
    test("should maintain proper data flow through all steps", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      // Verify complete success flow
      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Swarm was created successfully",
        data: {
          id: "placeholder-swarm-123",
          swarmId: "swarm2bCar4",
        },
      });

      // Verify all steps were executed in correct order
      expect(mockAuth).toHaveBeenCalled();
      expect(mockValidateWorkspaceAccessById).toHaveBeenCalled();
      expect(mockDb.$transaction).toHaveBeenCalled(); // Placeholder creation
      expect(mockSwarmServiceInstance.createSwarm).toHaveBeenCalled();
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledTimes(1); // Update placeholder with real data (encrypted)
    });
  });

  describe("Status Flow Management", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      // Ensure transaction returns new swarm (not existing)
      mockDb.$transaction.mockResolvedValue({
        exists: false,
        swarm: {
          id: "placeholder-swarm-123",
          status: SwarmStatus.PENDING,
        },
      });
    });

    test("should follow PENDING -> ACTIVE status flow on success", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify status flow: placeholder created with PENDING, then updated to ACTIVE via saveOrUpdateSwarm
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SwarmStatus.ACTIVE,
        })
      );
    });

    test("should follow PENDING -> FAILED status flow on error", async () => {
      mockSwarmServiceInstance.createSwarm.mockRejectedValue(new Error("Service error"));

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(500);

      // Verify status flow: placeholder created with PENDING, then updated to FAILED
      expect(mockDb.swarm.update).toHaveBeenCalledWith({
        where: { id: "placeholder-swarm-123" },
        data: {
          status: SwarmStatus.FAILED,
        },
      });
    });

    test("should handle placeholder creation with UUID name", async () => {
      mockRandomUUID.mockReturnValue("custom-uuid-456");

      // Setup transaction to capture what gets created
      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          swarm: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
              id: "placeholder-swarm-123",
              name: "custom-uuid-456",
              status: SwarmStatus.PENDING,
            }),
          },
          repository: {
            create: vi.fn(),
          },
        };

        const result = await callback(mockTx);

        // Verify placeholder was created with UUID name
        expect(mockTx.swarm.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: "custom-uuid-456",
            status: SwarmStatus.PENDING,
          }),
        });

        return result;
      });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm2bCar4",
          address: "swarm2bCar4.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      mockSaveOrUpdateSwarm.mockResolvedValue({
        id: "placeholder-swarm-123",
        swarmId: "swarm2bCar4",
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);
    });
  });
});