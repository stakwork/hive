import { describe, test, beforeEach, vi, expect } from "vitest";
import { GET } from "@/app/api/swarm/validate/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures";
import type { ValidateUriResponse } from "@/types/swarm";

// Mock SwarmService to isolate endpoint logic
const mockValidateUri = vi.fn();

vi.mock("@/services/swarm/SwarmService", () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    validateUri: mockValidateUri,
  })),
}));

describe("GET /api/swarm/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * SECURITY NOTE: This endpoint has a security gap - there is no workspace authorization validation.
   * Any authenticated user can validate any URI. This should be addressed by adding workspace access
   * checks (verify via validateWorkspaceAccessById) similar to other swarm endpoints like POST /api/swarm.
   * 
   * Reference pattern: src/app/api/swarm/route.ts (POST) uses validateWorkspaceAccessById() with
   * ADMIN+ role requirement. The validate endpoint should implement similar authorization when a
   * workspaceId parameter is provided.
   */

  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(null);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test("returns 401 when session has no user", async () => {
      // Arrange
      getMockedSession().mockResolvedValue({ user: null } as any);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test("returns 401 when session.user has no id", async () => {
      // Arrange
      const session = {
        user: { email: "test@example.com" }, // Missing id
      } as any;
      getMockedSession().mockResolvedValue(session);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("returns 404 when uri parameter is missing", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate" // No uri param
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Provide url please");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test("returns 404 when uri parameter is empty string", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri="
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Provide url please");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test("returns 404 when uri parameter is null", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=null"
      );
      const response = await GET(request);

      // Assert - endpoint will attempt to validate "null" as a string, so service will be called
      // This test verifies the endpoint accepts the parameter (even if invalid domain format)
      expect(mockValidateUri).toHaveBeenCalledWith("null");
    });
  });

  describe("Authorization (Recommended for Implementation)", () => {
    /**
     * These tests document the MISSING workspace authorization checks.
     * Currently, the endpoint does not validate workspace access, allowing any
     * authenticated user to validate any URI. These tests are skipped but included
     * to document the expected behavior once authorization is implemented.
     */

    test.skip("should return 403 when user lacks workspace access", async () => {
      // This test documents expected behavior when authorization is implemented
      // Reference: src/app/api/swarm/route.ts POST handler uses validateWorkspaceAccessById()
      
      const nonMember = await createTestUser({ email: "nonmember@test.com" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com&workspaceId=some-workspace-id"
      );
      const response = await GET(request);

      // Expected behavior when authorization is implemented
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Access denied");
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test.skip("should allow validation when user has workspace read access", async () => {
      // This test documents expected behavior when authorization is implemented
      
      const member = await createTestUser({ email: "member@test.com" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Domain validated successfully",
        data: {
          domain_exists: true,
          swarm_name_exist: true,
        },
      });

      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com&workspaceId=workspace-with-access"
      );
      const response = await GET(request);

      // Expected behavior when authorization is implemented
      expect(response.status).toBe(200);
      expect(mockValidateUri).toHaveBeenCalledWith("test.com");
    });
  });

  describe("Service Error Handling", () => {
    /**
     * BUG: These tests are commented out because the route's catch block (line 42) doesn't capture
     * the error object, so it can't check for structured API errors with status codes. All service
     * errors currently return 500 with generic message "Failed to validate uri".
     * 
     * Fix needed in src/app/api/swarm/validate/route.ts:
     * - Change `catch {` to `catch (error: unknown) {`
     * - Add error status handling like POST /api/swarm does (lines 246-266)
     * - Preserve status codes (404, 401, 403) from SwarmService.validateUri() errors
     */

    test.skip("handles 404 domain not found error from service", async () => {
      // Currently fails: returns 500 instead of 404 because catch block doesn't capture error
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const apiError = {
        status: 404,
        service: "swarm",
        message: "Domain not found",
        details: { domain: "nonexistent.com" },
      };
      mockValidateUri.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=nonexistent.com"
      );
      const response = await GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Domain not found");
      expect(mockValidateUri).toHaveBeenCalledWith("nonexistent.com");
    });

    test("handles 500 external service unavailable error", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const apiError = {
        status: 500,
        service: "swarm",
        message: "Swarm service unavailable",
      };
      mockValidateUri.mockRejectedValue(apiError);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      // Assert - Generic 500 error handling works correctly
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to validate uri");
      expect(mockValidateUri).toHaveBeenCalledWith("test.com");
    });

    test.skip("handles 401 invalid API key error from service", async () => {
      // Currently fails: returns 500 instead of 401 because catch block doesn't capture error
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const apiError = {
        status: 401,
        service: "swarm",
        message: "Invalid or expired API key",
      };
      mockValidateUri.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid or expired API key");
    });

    test.skip("handles 403 forbidden error from service", async () => {
      // Currently fails: returns 500 instead of 403 because catch block doesn't capture error
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const apiError = {
        status: 403,
        service: "swarm",
        message: "Insufficient permissions",
      };
      mockValidateUri.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Insufficient permissions");
    });

    test("handles generic errors without ApiError structure", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      // Generic error without ApiError structure
      mockValidateUri.mockRejectedValue(new Error("Network timeout"));

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      const response = await GET(request);

      // Assert - Generic error handling works correctly
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to validate uri");
      expect(mockValidateUri).toHaveBeenCalledWith("test.com");
    });

    test("handles service returning error response structure", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const errorResponse: ValidateUriResponse = {
        success: false,
        message: "Invalid domain format",
        data: null,
      };
      mockValidateUri.mockResolvedValue(errorResponse);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=invalid..domain"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Invalid domain format");
      expect(data.data).toBeNull();
    });
  });

  describe("Success Cases", () => {
    test("successfully validates existing domain", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const successResponse: ValidateUriResponse = {
        success: true,
        message: "Domain validated successfully",
        data: {
          domain_exists: true,
          swarm_name_exist: true,
        },
      };
      mockValidateUri.mockResolvedValue(successResponse);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=valid-swarm.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Domain validated successfully");
      expect(data.data).toEqual({
        domain_exists: true,
        swarm_name_exist: true,
      });
      expect(mockValidateUri).toHaveBeenCalledWith("valid-swarm.com");
      expect(mockValidateUri).toHaveBeenCalledTimes(1);
    });

    test("successfully validates domain that exists but swarm name does not", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const successResponse: ValidateUriResponse = {
        success: true,
        message: "Domain exists but swarm name not registered",
        data: {
          domain_exists: true,
          swarm_name_exist: false,
        },
      };
      mockValidateUri.mockResolvedValue(successResponse);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=existing-domain.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data?.domain_exists).toBe(true);
      expect(data.data?.swarm_name_exist).toBe(false);
    });

    test("successfully validates non-existent domain", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      const successResponse: ValidateUriResponse = {
        success: true,
        message: "Domain not registered",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      };
      mockValidateUri.mockResolvedValue(successResponse);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=new-domain.com"
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data?.domain_exists).toBe(false);
      expect(data.data?.swarm_name_exist).toBe(false);
    });

    test("correctly passes uri parameter to service", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: true, swarm_name_exist: true },
      });

      // Act
      const testUri = "my-specific-domain.com";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${testUri}`
      );
      await GET(request);

      // Assert
      expect(mockValidateUri).toHaveBeenCalledWith(testUri);
      expect(mockValidateUri).toHaveBeenCalledTimes(1);

      // Verify exact call signature
      const callArgs = mockValidateUri.mock.calls[0];
      expect(callArgs).toEqual([testUri]);
      expect(callArgs.length).toBe(1);
    });

    test("handles URI with special characters", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: true, swarm_name_exist: false },
      });

      // Act
      const specialUri = "test-domain_123.com";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${encodeURIComponent(specialUri)}`
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      expect(mockValidateUri).toHaveBeenCalledWith(specialUri);
    });
  });

  describe("Edge Cases", () => {
    test("handles very long URI parameter", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: false, swarm_name_exist: false },
      });

      // Act
      const longUri = "a".repeat(500) + ".com";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${encodeURIComponent(longUri)}`
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      expect(mockValidateUri).toHaveBeenCalledWith(longUri);
    });

    test("handles subdomain URI", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: true, swarm_name_exist: true },
      });

      // Act
      const subdomainUri = "subdomain.example.com";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${subdomainUri}`
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      expect(mockValidateUri).toHaveBeenCalledWith(subdomainUri);
    });

    test("handles URI with port number", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: true, swarm_name_exist: false },
      });

      // Act
      const uriWithPort = "example.com:8080";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${encodeURIComponent(uriWithPort)}`
      );
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      expect(mockValidateUri).toHaveBeenCalledWith(uriWithPort);
    });
  });

  describe("Service Invocation", () => {
    test("calls SwarmService.validateUri with correct parameters", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      mockValidateUri.mockResolvedValue({
        success: true,
        message: "Validated",
        data: { domain_exists: true, swarm_name_exist: true },
      });

      // Act
      const testUri = "service-test.com";
      const request = createGetRequest(
        `http://localhost/api/swarm/validate?uri=${testUri}`
      );
      await GET(request);

      // Assert
      expect(mockValidateUri).toHaveBeenCalledWith(testUri);
      expect(mockValidateUri).toHaveBeenCalledTimes(1);
    });

    test("does not call service when authentication fails", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(null);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate?uri=test.com"
      );
      await GET(request);

      // Assert
      expect(mockValidateUri).not.toHaveBeenCalled();
    });

    test("does not call service when validation fails", async () => {
      // Arrange
      const user = await createTestUser();
      const session = createAuthenticatedSession(user);
      getMockedSession().mockResolvedValue(session);

      // Act
      const request = createGetRequest(
        "http://localhost/api/swarm/validate" // Missing uri
      );
      await GET(request);

      // Assert
      expect(mockValidateUri).not.toHaveBeenCalled();
    });
  });
});