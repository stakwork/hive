import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/swarm/route";
import { getServerSession } from "next-auth/next";
import { generateSecurePassword } from "@/lib/utils/password";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";
import { SwarmStatus } from "@prisma/client";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/utils/password", () => ({
  generateSecurePassword: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: vi.fn(),
}));

vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("@/services/swarm/fake", () => ({
  isFakeMode: false,
  createFakeSwarm: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as Mock;
const mockGenerateSecurePassword = generateSecurePassword as Mock;
const mockValidateWorkspaceAccessById = validateWorkspaceAccessById as Mock;
const mockSaveOrUpdateSwarm = saveOrUpdateSwarm as Mock;
const mockSwarmService = SwarmService as Mock;
const mockGetServiceConfig = getServiceConfig as Mock;

describe("POST /api/swarm - Unit Tests", () => {
  let mockSwarmServiceInstance: {
    createSwarm: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup SwarmService mock instance
    mockSwarmServiceInstance = {
      createSwarm: vi.fn(),
    };
    mockSwarmService.mockImplementation(() => mockSwarmServiceInstance);
    
    // Default mocks
    mockGetServiceConfig.mockReturnValue({
      baseURL: "https://swarm.example.com",
      apiKey: "test-api-key",
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
    });
    
    mockGenerateSecurePassword.mockReturnValue("secure-test-password-123");
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
      mockGetServerSession.mockResolvedValue(null);

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
      mockGetServerSession.mockResolvedValue({
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
      mockGetServerSession.mockResolvedValue({
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
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });
      
      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      mockSaveOrUpdateSwarm
        .mockResolvedValueOnce({ id: "temp-swarm" }) // First call
        .mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" }); // Second call

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: "sensitive-api-key-789",
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockValidateWorkspaceAccessById).toHaveBeenCalledWith(
        "workspace-123",
        "user-123"
      );
    });
  });

  describe("Input Validation", () => {
    test("should reject requests with missing workspaceId", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });

      const invalidData = { ...validSwarmData };
      delete (invalidData as any).workspaceId;

      const request = createMockRequest(invalidData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: workspaceId, name, repositoryName, repositoryUrl");
    });

    test("should reject requests with missing name", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });

      const invalidData = { ...validSwarmData };
      delete (invalidData as any).name;

      const request = createMockRequest(invalidData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required fields: workspaceId, name, repositoryName, repositoryUrl");
    });

    test("should reject requests with missing repository fields", async () => {
      mockGetServerSession.mockResolvedValue({
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
      expect(data.message).toBe("Missing required fields: workspaceId, name, repositoryName, repositoryUrl");
    });
  });

  describe("Sensitive Data Handling", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });
      
      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });
    });

    test("should generate secure password for swarm", async () => {
      mockSaveOrUpdateSwarm
        .mockResolvedValueOnce({ id: "temp-swarm" })
        .mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
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
      
      mockSaveOrUpdateSwarm
        .mockResolvedValueOnce({ id: "temp-swarm" })
        .mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: sensitiveApiKey,
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      // Verify API key is not exposed in response
      expect(JSON.stringify(data)).not.toContain(sensitiveApiKey);
      expect(data.data).toEqual({
        id: "final-swarm",
        swarmId: "swarm-456",
      });

      // Verify API key was saved to database securely
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledTimes(2);
      const secondCall = mockSaveOrUpdateSwarm.mock.calls[1][0];
      expect(secondCall).toMatchObject({
        workspaceId: "workspace-123",
        swarmApiKey: sensitiveApiKey,
        swarmPassword: "secure-test-password-123",
      });
    });

    test("should create secure secret alias", async () => {
      mockSaveOrUpdateSwarm
        .mockResolvedValueOnce({ id: "temp-swarm" })
        .mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);

      const saveCall = mockSaveOrUpdateSwarm.mock.calls[0][0];
      expect(saveCall.swarmSecretAlias).toBe("{{SWARM_456_API_KEY}}");
    });
  });

  describe("External Service Integration", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });
    });

    test("should handle external service errors gracefully", async () => {
      const serviceError = new Error("External service unavailable");
      (serviceError as any).status = 503;
      (serviceError as any).message = "Service temporarily unavailable";

      mockSwarmServiceInstance.createSwarm.mockRejectedValue(serviceError);

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Service temporarily unavailable");

      // Verify no database save occurred since service failed
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledTimes(0);
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
    });

    test("should handle malformed external service responses", async () => {
      mockSaveOrUpdateSwarm
        .mockResolvedValueOnce({ id: "temp-swarm" })
        .mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" });

      // Malformed response missing required fields
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          // Missing swarm_id, address, x_api_key
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);

      expect(response.status).toBe(200); // Should still succeed
      
      // Verify it handles undefined values gracefully
      const secondCall = mockSaveOrUpdateSwarm.mock.calls[1][0];
      expect(secondCall).toMatchObject({
        workspaceId: "workspace-123",
        swarmUrl: "https://undefined/api", // undefined address becomes "undefined"
        swarmApiKey: undefined,
        swarmSecretAlias: "{{SWARM_undefined_API_KEY}}", // undefined swarm_id becomes "undefined"
      });
    });
  });

  describe("Database Operations", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });
    });

    test("should save swarm only after successful service creation", async () => {
      mockSaveOrUpdateSwarm.mockResolvedValueOnce({ id: "final-swarm" });
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: "api-key-123",
          ec2_id: "i-1234567890abcdef0",
        },
      });

      const request = createMockRequest(validSwarmData);
      await POST(request);

      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-123",
        name: "swarm-456", // Uses swarm_id as name
        instanceType: "m6i.xlarge",
        status: SwarmStatus.ACTIVE,
        repositoryName: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        repositoryDescription: "Test repository",
        defaultBranch: "main",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        ec2Id: "i-1234567890abcdef0",
        swarmApiKey: "api-key-123",
        swarmSecretAlias: "{{SWARM_456_API_KEY}}",
        swarmId: "swarm-456",
        swarmPassword: "secure-test-password-123",
      });
    });

    test("should handle database save failure after service creation", async () => {
      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
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

    test("should handle failed swarm creation", async () => {
      mockSaveOrUpdateSwarm.mockResolvedValueOnce(null); // Failed creation

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to create swarm record");
    });
  });

  describe("Data Flow and State Management", () => {
    test("should maintain proper data flow through all steps", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user-123" },
      });

      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
      });

      mockSaveOrUpdateSwarm.mockResolvedValueOnce({ id: "final-swarm", swarmId: "swarm-456" });

      mockSwarmServiceInstance.createSwarm.mockResolvedValue({
        data: {
          swarm_id: "swarm-456",
          address: "test-swarm.sphinx.chat",
          x_api_key: "api-key-123",
        },
      });

      const request = createMockRequest(validSwarmData);
      const response = await POST(request);
      const data = await response.json();

      // Verify complete success flow
      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "test-swarm-Swarm was created successfully",
        data: {
          id: "final-swarm",
          swarmId: "swarm-456",
        },
      });

      // Verify all steps were executed in correct order
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockValidateWorkspaceAccessById).toHaveBeenCalled();
      expect(mockSwarmServiceInstance.createSwarm).toHaveBeenCalled();
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledTimes(1); // Only called once after service creation
    });
  });
});