import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/swarm/validate/route";
import { getServerSession } from "next-auth/next";
import { validateUriApi } from "@/services/swarm/api/swarm";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import type { ValidateUriResponse } from "@/types";

// Mock external dependencies
vi.mock("next-auth/next");
vi.mock("@/services/swarm/api/swarm");

describe("GET /api/swarm/validate Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      // Mock unauthenticated session
      vi.mocked(getServerSession).mockResolvedValue(null);

      // Create request without authentication
      const request = new Request("http://localhost/api/swarm/validate?uri=test.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert unauthorized response
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should return 401 when session exists but user id is missing", async () => {
      // Mock session without user id
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=test.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert unauthorized response
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    it("should allow authenticated users to validate URIs", async () => {
      // Create test user
      const user = await createTestUser({ 
        email: "test@example.com",
        name: "Test User" 
      });

      // Mock authenticated session
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user.id, 
          email: user.email!, 
          name: user.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      // Mock successful validation response
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain validated",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      });

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=test.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert successful authentication
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Query Parameter Validation", () => {
    let user: any;

    beforeEach(async () => {
      // Create authenticated user for all parameter validation tests
      user = await createTestUser({ 
        email: "param-test@example.com",
        name: "Param Test User"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user.id, 
          email: user.email!, 
          name: user.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    it("should return 404 when uri parameter is missing", async () => {
      // Create request without uri query parameter
      const request = new Request("http://localhost/api/swarm/validate");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert 404 with specific error message
      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Provide url please");
    });

    it("should return 404 when uri parameter is empty string", async () => {
      // Create request with empty uri parameter
      const request = new Request("http://localhost/api/swarm/validate?uri=");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert 404 response
      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Provide url please");
    });

    it("should validate URI when parameter is provided", async () => {
      // Mock successful validation
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain validated",
        data: {
          domain_exists: true,
          swarm_name_exist: false,
        },
      });

      // Create request with valid uri parameter
      const request = new Request("http://localhost/api/swarm/validate?uri=test.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert successful validation
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.domain_exists).toBe(true);
      expect(data.data.swarm_name_exist).toBe(false);
    });

    it("should pass URI parameter correctly to validation API", async () => {
      const testUri = "custom-domain.sphinxlabs.ai";

      // Mock successful validation
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain validated",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      });

      // Create request with custom URI
      const request = new Request(`http://localhost/api/swarm/validate?uri=${testUri}`);

      // Call route handler
      await GET(request as any);

      // Assert validateUriApi was called with correct URI
      expect(validateUriApi).toHaveBeenCalledTimes(1);
      expect(validateUriApi).toHaveBeenCalledWith(expect.anything(), testUri);
    });

    it("should handle URIs with special characters", async () => {
      const testUri = "test-123.domain.com";

      // Mock successful validation
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain validated",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      });

      // Create request with special character URI
      const request = new Request(`http://localhost/api/swarm/validate?uri=${encodeURIComponent(testUri)}`);

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert successful validation
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(validateUriApi).toHaveBeenCalledWith(expect.anything(), testUri);
    });
  });

  describe("External API Response Handling", () => {
    let user: any;

    beforeEach(async () => {
      // Create authenticated user for all API response tests
      user = await createTestUser({ 
        email: "api-test@example.com",
        name: "API Test User"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user.id, 
          email: user.email!, 
          name: user.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    it("should return validation data when domain does not exist", async () => {
      // Mock validation response for new domain
      const validationResponse: ValidateUriResponse = {
        success: true,
        message: "Domain available",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      };
      vi.mocked(validateUriApi).mockResolvedValue(validationResponse);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=new-domain.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert response matches validation data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Domain available");
      expect(data.data.domain_exists).toBe(false);
      expect(data.data.swarm_name_exist).toBe(false);
    });

    it("should return validation data when domain exists", async () => {
      // Mock validation response for existing domain
      const validationResponse: ValidateUriResponse = {
        success: true,
        message: "Domain exists",
        data: {
          domain_exists: true,
          swarm_name_exist: true,
        },
      };
      vi.mocked(validateUriApi).mockResolvedValue(validationResponse);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=existing-domain.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert response indicates existing domain
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Domain exists");
      expect(data.data.domain_exists).toBe(true);
      expect(data.data.swarm_name_exist).toBe(true);
    });

    it("should return validation data when domain exists but swarm name is available", async () => {
      // Mock validation response for mixed scenario
      const validationResponse: ValidateUriResponse = {
        success: true,
        message: "Swarm name available",
        data: {
          domain_exists: true,
          swarm_name_exist: false,
        },
      };
      vi.mocked(validateUriApi).mockResolvedValue(validationResponse);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=partial.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert mixed validation state
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.domain_exists).toBe(true);
      expect(data.data.swarm_name_exist).toBe(false);
    });

    it("should return 500 when external API throws error", async () => {
      // Mock API throwing error
      vi.mocked(validateUriApi).mockRejectedValue(new Error("External API connection failed"));

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=test.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert 500 error response
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to validate uri");
    });

    it("should return 500 when API throws network timeout", async () => {
      // Mock API timeout error
      vi.mocked(validateUriApi).mockRejectedValue(new Error("Request timeout"));

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=timeout.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert 500 error response
      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to validate uri");
    });

    it("should handle API response with success false", async () => {
      // Mock API returning failure
      const validationResponse: ValidateUriResponse = {
        success: false,
        message: "Validation failed - invalid domain format",
        data: null,
      };
      vi.mocked(validateUriApi).mockResolvedValue(validationResponse);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=invalid.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert response propagates API failure
      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Validation failed - invalid domain format");
      expect(data.data).toBe(null);
    });

    it("should handle API response with null data", async () => {
      // Mock API returning null data
      const validationResponse: ValidateUriResponse = {
        success: true,
        message: "No data available",
        data: null,
      };
      vi.mocked(validateUriApi).mockResolvedValue(validationResponse);

      // Create request
      const request = new Request("http://localhost/api/swarm/validate?uri=nodata.sphinxlabs.ai");

      // Call route handler
      const response = await GET(request as any);
      const data = await response.json();

      // Assert response handles null data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBe(null);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle multiple validation requests in sequence", async () => {
      // Create test user
      const user = await createTestUser({ 
        email: "sequence-test@example.com",
        name: "Sequence Test User"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user.id, 
          email: user.email!, 
          name: user.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      // First validation - new domain
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain available",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      const request1 = new Request("http://localhost/api/swarm/validate?uri=first.sphinxlabs.ai");
      const response1 = await GET(request1 as any);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.data.domain_exists).toBe(false);

      // Second validation - existing domain
      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Domain exists",
        data: { domain_exists: true, swarm_name_exist: true },
      });

      const request2 = new Request("http://localhost/api/swarm/validate?uri=second.sphinxlabs.ai");
      const response2 = await GET(request2 as any);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.data.domain_exists).toBe(true);

      // Verify API was called twice
      expect(validateUriApi).toHaveBeenCalledTimes(2);
    });

    it("should work with different user accounts", async () => {
      // Create first user
      const user1 = await createTestUser({ 
        email: "user1@example.com",
        name: "User One"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user1.id, 
          email: user1.email!, 
          name: user1.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      // First user's request
      const request1 = new Request("http://localhost/api/swarm/validate?uri=user1.sphinxlabs.ai");
      const response1 = await GET(request1 as any);

      expect(response1.status).toBe(200);

      // Create second user
      const user2 = await createTestUser({ 
        email: "user2@example.com",
        name: "User Two"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user2.id, 
          email: user2.email!, 
          name: user2.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      // Second user's request
      const request2 = new Request("http://localhost/api/swarm/validate?uri=user2.sphinxlabs.ai");
      const response2 = await GET(request2 as any);

      expect(response2.status).toBe(200);

      // Verify both requests succeeded
      expect(validateUriApi).toHaveBeenCalledTimes(2);
    });
  });

  describe("Edge Cases", () => {
    let user: any;

    beforeEach(async () => {
      user = await createTestUser({ 
        email: "edge-test@example.com",
        name: "Edge Test User"
      });
      
      vi.mocked(getServerSession).mockResolvedValue({
        user: { 
          id: user.id, 
          email: user.email!, 
          name: user.name 
        },
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);
    });

    it("should handle very long URIs", async () => {
      const longUri = "a".repeat(200) + ".sphinxlabs.ai";

      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      const request = new Request(`http://localhost/api/swarm/validate?uri=${encodeURIComponent(longUri)}`);
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      expect(validateUriApi).toHaveBeenCalledWith(expect.anything(), longUri);
    });

    it("should handle URIs with multiple subdomains", async () => {
      const complexUri = "sub1.sub2.sub3.domain.sphinxlabs.ai";

      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      const request = new Request(`http://localhost/api/swarm/validate?uri=${complexUri}`);
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      expect(validateUriApi).toHaveBeenCalledWith(expect.anything(), complexUri);
    });

    it("should handle URIs with port numbers", async () => {
      const uriWithPort = "test.sphinxlabs.ai:8080";

      vi.mocked(validateUriApi).mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      const request = new Request(`http://localhost/api/swarm/validate?uri=${uriWithPort}`);
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      expect(validateUriApi).toHaveBeenCalledWith(expect.anything(), uriWithPort);
    });
  });
});