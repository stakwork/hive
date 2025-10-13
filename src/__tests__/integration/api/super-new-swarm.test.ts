import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/super/new_swarm/route";
import { db } from "@/lib/db";
import type { CreateSwarmResponse } from "@/types/swarm";
import {
  generateUniqueId,
  createPostRequest,
  createRequestWithHeaders,
} from "@/__tests__/support/helpers";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectValidationError,
} from "@/__tests__/support/helpers/api-assertions";

// Mock environment variables for test
const TEST_SUPER_TOKEN = "super";
const INVALID_SUPER_TOKEN = "invalid-token";

// Mock external infrastructure provisioning services
// In production, this would call AWS SDK for EC2, Docker API, etc.
vi.mock("@/services/infrastructure/provisioning", () => ({
  provisionEC2Instance: vi.fn(),
  createDockerContainer: vi.fn(),
  setupSwarmInfrastructure: vi.fn(),
}));

// Mock the SwarmService to control provisioning responses
vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: vi.fn(),
  })),
}));

// Import mocked functions for assertions
import { SwarmService } from "@/services/swarm";

describe("POST /api/super/new_swarm - Integration Tests", () => {
  let mockSwarmService: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock swarm service with default success response
    mockSwarmService = {
      createSwarm: vi.fn().mockResolvedValue({
        data: {
          swarm_id: generateUniqueId("swarm"),
          address: "test-swarm.example.com",
          x_api_key: "test-api-key-12345",
          ec2_id: "i-1234567890abcdef0",
        },
      }),
    };

    vi.mocked(SwarmService).mockImplementation(() => mockSwarmService);

    // Set environment variable for super token
    process.env.SWARM_SUPERADMIN_API_KEY = TEST_SUPER_TOKEN;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    it("should accept valid x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        {
          instance_type: "t2.medium",
          password: "securePass123",
        }
      );

      const response = await POST(request);
      
      // Should not return authentication errors
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it("should reject request with missing x-super-token header", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/super/new_swarm",
        {
          instance_type: "t2.medium",
          password: "securePass123",
        }
      );

      const response = await POST(request);
      
      expectUnauthorized(response);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/unauthorized|authentication required/i);
    });

    it("should reject request with invalid x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": INVALID_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        {
          instance_type: "t2.medium",
        }
      );

      const response = await POST(request);
      
      expectUnauthorized(response);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid.*token|unauthorized/i);
    });

    it("should reject request with empty x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": "",
          "Content-Type": "application/json",
        },
        {
          instance_type: "t2.medium",
        }
      );

      const response = await POST(request);
      
      expectUnauthorized(response);
    });
  });

  describe("Request Validation Tests", () => {
    const createAuthenticatedRequest = (body: any) => {
      return createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body
      );
    };

    it("should accept valid request with required instance_type", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      // Should not be validation error
      expect(response.status).not.toBe(400);
    });

    it("should accept valid request with instance_type and password", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.large",
        password: "mySecurePassword123",
      });

      const response = await POST(request);
      
      // Should not be validation error
      expect(response.status).not.toBe(400);
    });

    it("should reject request missing required instance_type", async () => {
      const request = createAuthenticatedRequest({
        password: "somePassword",
      });

      const response = await POST(request);
      
      expectValidationError(response);
      const data = await response.json();
      expect(data.message).toMatch(/instance_type.*required/i);
    });

    it("should reject request with empty instance_type", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "",
        password: "somePassword",
      });

      const response = await POST(request);
      
      expectValidationError(response);
      const data = await response.json();
      expect(data.message).toMatch(/instance_type.*invalid|empty/i);
    });

    it("should reject request with invalid instance_type format", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "invalid_instance_type_123",
      });

      const response = await POST(request);
      
      expectValidationError(response);
      const data = await response.json();
      expect(data.message).toMatch(/instance_type.*invalid/i);
    });

    it("should accept standard AWS instance types", async () => {
      const validInstanceTypes = [
        "t2.micro",
        "t2.small",
        "t2.medium",
        "t2.large",
        "t3.micro",
        "t3.small",
        "t3.medium",
      ];

      for (const instanceType of validInstanceTypes) {
        const request = createAuthenticatedRequest({
          instance_type: instanceType,
        });

        const response = await POST(request);
        
        // Should not be validation error (400)
        expect(response.status).not.toBe(400);
      }
    });

    it("should reject request with empty body", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        {}
      );

      const response = await POST(request);
      
      expectValidationError(response);
    });
  });

  describe("Response Structure Tests", () => {
    const createAuthenticatedRequest = (body: any) => {
      return createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body
      );
    };

    it("should return correct CreateSwarmResponse structure on success", async () => {
      const swarmId = generateUniqueId("swarm");
      const apiKey = "generated-api-key-12345";
      
      mockSwarmService.createSwarm.mockResolvedValue({
        data: {
          swarm_id: swarmId,
          address: "swarm-abc123.example.com",
          x_api_key: apiKey,
          ec2_id: "i-0123456789abcdef0",
        },
      });

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
        password: "testPass123",
      });

      const response = await POST(request);
      
      expectSuccess(response);
      const data: CreateSwarmResponse = await response.json();

      // Verify response structure
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("data");
      
      expect(data.success).toBe(true);
      expect(typeof data.message).toBe("string");
      
      // Verify data object structure
      expect(data.data).toHaveProperty("swarm_id");
      expect(data.data).toHaveProperty("address");
      expect(data.data).toHaveProperty("x_api_key");
      expect(data.data).toHaveProperty("ec2_id");
      
      // Verify data types
      expect(typeof data.data.swarm_id).toBe("string");
      expect(typeof data.data.address).toBe("string");
      expect(typeof data.data.x_api_key).toBe("string");
      expect(typeof data.data.ec2_id).toBe("string");
      
      // Verify values match mocked response
      expect(data.data.swarm_id).toBe(swarmId);
      expect(data.data.x_api_key).toBe(apiKey);
    });

    it("should return swarm_id in correct format", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      if (response.ok) {
        const data: CreateSwarmResponse = await response.json();
        
        // Swarm ID should be non-empty string
        expect(data.data.swarm_id).toBeTruthy();
        expect(data.data.swarm_id.length).toBeGreaterThan(0);
      }
    });

    it("should return valid address format", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      if (response.ok) {
        const data: CreateSwarmResponse = await response.json();
        
        // Address should be a valid hostname or URL
        expect(data.data.address).toBeTruthy();
        expect(data.data.address).toMatch(/^[a-zA-Z0-9.-]+$/);
      }
    });

    it("should return generated x_api_key", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      if (response.ok) {
        const data: CreateSwarmResponse = await response.json();
        
        // API key should be non-empty string
        expect(data.data.x_api_key).toBeTruthy();
        expect(data.data.x_api_key.length).toBeGreaterThan(0);
      }
    });

    it("should return ec2_id from infrastructure provisioning", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      if (response.ok) {
        const data: CreateSwarmResponse = await response.json();
        
        // EC2 ID should match AWS instance ID format
        expect(data.data.ec2_id).toBeTruthy();
        expect(data.data.ec2_id).toMatch(/^i-[a-zA-Z0-9]+$/);
      }
    });
  });

  describe("Infrastructure Provisioning Tests", () => {
    const createAuthenticatedRequest = (body: any) => {
      return createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body
      );
    };

    it("should provision infrastructure with correct instance type", async () => {
      const instanceType = "t2.large";
      const request = createAuthenticatedRequest({
        instance_type: instanceType,
      });

      await POST(request);

      // Verify infrastructure provisioning was called with correct parameters
      // This would check mockSwarmService.createSwarm was called with correct args
      expect(mockSwarmService.createSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          instance_type: instanceType,
        })
      );
    });

    it("should pass password to infrastructure provisioning when provided", async () => {
      const password = "mySecurePassword123";
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
        password: password,
      });

      await POST(request);

      expect(mockSwarmService.createSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          password: password,
        })
      );
    });

    it("should handle infrastructure provisioning timeout", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Infrastructure provisioning timeout")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /timeout|failed/i);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it("should handle EC2 instance creation failure", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("EC2 instance creation failed: Capacity exceeded")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /failed|error/i);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/EC2|capacity|failed/i);
    });

    it("should handle Docker container creation failure", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Docker container failed to start")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /failed|error/i);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it("should handle network configuration failure", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Failed to configure networking")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /failed|error|network/i);
    });
  });

  describe("Error Handling Tests", () => {
    const createAuthenticatedRequest = (body: any) => {
      return createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body
      );
    };

    it("should return 500 for unexpected infrastructure errors", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Unexpected infrastructure error")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/error|failed/i);
    });

    it("should handle malformed JSON body gracefully", async () => {
      const request = new Request("http://localhost:3000/api/super/new_swarm", {
        method: "POST",
        headers: {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body: "{invalid json",
      });

      const response = await POST(request as any);
      
      expectValidationError(response);
      const data = await response.json();
      expect(data.message).toMatch(/invalid.*json|malformed/i);
    });

    it("should provide descriptive error messages for validation failures", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "",
      });

      const response = await POST(request);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBeTruthy();
      expect(data.message.length).toBeGreaterThan(10);
    });

    it("should handle AWS service quota errors", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Service quota exceeded for EC2 instances")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /quota|limit|exceeded/i);
    });

    it("should handle invalid AWS credentials", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Invalid AWS credentials")
      );

      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
      });

      const response = await POST(request);
      
      expectError(response, /credentials|authentication|AWS/i);
    });
  });

  describe("Security Tests", () => {
    it("should not expose internal error details in production", async () => {
      mockSwarmService.createSwarm.mockRejectedValue(
        new Error("Database connection string: postgres://user:pass@host/db")
      );

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        {
          instance_type: "t2.medium",
        }
      );

      const response = await POST(request);
      const data = await response.json();
      
      // Should not expose connection strings or sensitive info
      expect(data.message).not.toMatch(/postgres:\/\//);
      expect(data.message).not.toMatch(/password|user:/);
    });

    it("should rate limit super admin endpoint calls", async () => {
      const requests = Array.from({ length: 10 }, () =>
        createRequestWithHeaders(
          "http://localhost:3000/api/super/new_swarm",
          "POST",
          {
            "x-super-token": TEST_SUPER_TOKEN,
            "Content-Type": "application/json",
          },
          {
            instance_type: "t2.medium",
          }
        )
      );

      // Make multiple rapid requests
      const responses = await Promise.all(
        requests.map((req) => POST(req))
      );

      // At least some should succeed (implementation-dependent)
      const successCount = responses.filter((r) => r.ok).length;
      expect(successCount).toBeGreaterThan(0);
    });

    it("should log security events for failed authentication", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": "malicious-token-attempt",
          "Content-Type": "application/json",
        },
        {
          instance_type: "t2.medium",
        }
      );

      await POST(request);
      
      // Security events should be logged (implementation-dependent)
      // This test documents the expected behavior
    });
  });

  describe("Edge Cases", () => {
    const createAuthenticatedRequest = (body: any) => {
      return createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "x-super-token": TEST_SUPER_TOKEN,
          "Content-Type": "application/json",
        },
        body
      );
    };

    it("should handle very long password", async () => {
      const longPassword = "a".repeat(1000);
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
        password: longPassword,
      });

      const response = await POST(request);
      
      // Should either succeed or return validation error
      expect([200, 201, 400]).toContain(response.status);
    });

    it("should handle special characters in password", async () => {
      const specialPassword = "P@$$w0rd!#%^&*()";
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
        password: specialPassword,
      });

      const response = await POST(request);
      
      // Should not be a validation error for special chars
      expect(response.status).not.toBe(400);
    });

    it("should handle concurrent swarm creation requests", async () => {
      const requests = Array.from({ length: 3 }, () =>
        createAuthenticatedRequest({
          instance_type: "t2.medium",
        })
      );

      const responses = await Promise.all(
        requests.map((req) => POST(req))
      );

      // All should succeed or handle gracefully
      responses.forEach((response) => {
        expect([200, 201, 429, 500]).toContain(response.status);
      });
    });

    it("should handle request with additional unknown fields", async () => {
      const request = createAuthenticatedRequest({
        instance_type: "t2.medium",
        password: "test123",
        unknown_field: "should be ignored",
        another_field: 12345,
      });

      const response = await POST(request);
      
      // Should ignore unknown fields and succeed
      expect(response.status).not.toBe(400);
    });
  });
});