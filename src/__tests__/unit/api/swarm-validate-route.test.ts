import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/swarm/validate/route";
import { auth } from "@/lib/auth";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";
import { ValidateUriResponse } from "@/types/swarm";

// Mock external dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as Mock;
const mockSwarmService = SwarmService as Mock;
const mockGetServiceConfig = getServiceConfig as Mock;

describe("GET /api/swarm/validate - Unit Tests", () => {
  let mockSwarmServiceInstance: {
    validateUri: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup SwarmService mock instance
    mockSwarmServiceInstance = {
      validateUri: vi.fn(),
    };
    mockSwarmService.mockImplementation(() => mockSwarmServiceInstance);

    // Default service config mock
    mockGetServiceConfig.mockReturnValue({
      baseURL: "https://swarm-superadmin.example.com",
      apiKey: "test-super-admin-key",
      timeout: 120000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  // Test Data Factories
  const TestDataFactory = {
    createValidSession: () => ({
      user: {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }),

    createValidateUriResponse: (overrides = {}): ValidateUriResponse => ({
      success: true,
      message: "Domain validated successfully",
      data: {
        domain_exists: true,
        swarm_name_exist: true,
        ...overrides,
      },
    }),

    createFailedValidateUriResponse: (message: string): ValidateUriResponse => ({
      success: false,
      message,
      data: null,
    }),
  };

  // Test Helpers
  const TestHelpers = {
    createGetRequest: (uri?: string) => {
      const url = uri
        ? `http://localhost:3000/api/swarm/validate?uri=${encodeURIComponent(uri)}`
        : "http://localhost:3000/api/swarm/validate";
      return new NextRequest(url, { method: "GET" });
    },

    setupAuthenticatedUser: () => {
      mockGetServerSession.mockResolvedValue(TestDataFactory.createValidSession());
    },

    setupUnauthenticatedUser: () => {
      mockGetServerSession.mockResolvedValue(null);
    },

    expectAuthenticationError: async (response: Response) => {
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ success: false, message: "Unauthorized" });
    },

    expectValidationError: async (response: Response, expectedStatus: number, expectedMessage: string) => {
      expect(response.status).toBe(expectedStatus);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe(expectedMessage);
    },

    expectSuccessfulResponse: async (response: Response, expectedData?: ValidateUriResponse["data"]) => {
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      if (expectedData) {
        expect(data.data).toEqual(expectedData);
      }
    },
  };

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectAuthenticationError(response);
      expect(mockSwarmServiceInstance.validateUri).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        expires: new Date().toISOString(),
      });

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should return 401 when session.user.id is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      });

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectAuthenticationError(response);
    });

    test("should proceed with valid session", async () => {
      TestHelpers.setupAuthenticatedUser();
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockGetServerSession).toHaveBeenCalled();
    });
  });

  describe("Authorization Gaps (Security Vulnerability)", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("SECURITY GAP: endpoint does NOT validate workspace access", async () => {
      // CRITICAL: This test documents that the endpoint is missing workspace-level authorization
      // Reference implementations (POST /api/swarm, PUT /api/swarm) use validateWorkspaceAccessById()
      // but this endpoint does NOT - any authenticated user can validate any swarm URI
      
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("unauthorized-workspace-swarm.sphinx.chat");
      const response = await GET(request);

      // Currently returns 200 even for unauthorized workspace access
      expect(response.status).toBe(200);
      
      // RECOMMENDATION: Should add workspaceId parameter and validate access:
      // const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
      // if (!workspaceAccess.hasAccess) {
      //   return NextResponse.json({ success: false, message: "Access denied" }, { status: 403 });
      // }
    });

    test("SECURITY GAP: endpoint does NOT check workspace membership", async () => {
      // This endpoint allows any authenticated user to validate URIs for swarms they don't have access to
      // This differs from other swarm endpoints which enforce workspace-level permissions
      
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("cross-workspace-swarm.sphinx.chat");
      const response = await GET(request);

      // No 403 Forbidden response - missing authorization check
      expect(response.status).not.toBe(403);
      expect(response.status).toBe(200);
    });

    test("SECURITY GAP: endpoint does NOT enforce minimum permission level", async () => {
      // Other swarm endpoints check canRead/canWrite/canAdmin permissions
      // This endpoint has no permission level enforcement
      
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      // No permission level check - proceeds regardless of user role
      expect(response.status).toBe(200);
    });
  });

  describe("Parameter Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 404 when uri parameter is missing", async () => {
      const request = TestHelpers.createGetRequest();
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 404, "Provide url please");
      expect(mockSwarmServiceInstance.validateUri).not.toHaveBeenCalled();
    });

    test("should return 404 when uri is empty string", async () => {
      const request = TestHelpers.createGetRequest("");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 404, "Provide url please");
      expect(mockSwarmServiceInstance.validateUri).not.toHaveBeenCalled();
    });

    test("should accept valid domain format", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith("test-swarm.sphinx.chat");
    });

    test("should accept URI with subdomain", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("my-team-swarm-123.sphinx.chat");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith("my-team-swarm-123.sphinx.chat");
    });

    test("should handle URI with special characters", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test_swarm-v2.sphinx.chat");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith("test_swarm-v2.sphinx.chat");
    });
  });

  describe("Input Sanitization Gaps (Security Vulnerability)", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("SECURITY GAP: does NOT sanitize XSS patterns in URI", async () => {
      // CRITICAL: No XSS protection - malicious URIs are passed directly to external API
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const xssUri = "javascript:alert('xss')";
      const request = TestHelpers.createGetRequest(xssUri);
      const response = await GET(request);

      // Currently passes unsanitized URI to service - potential XSS vulnerability
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(xssUri);
      
      // RECOMMENDATION: Add URI validation before service call:
      // if (uri.startsWith('javascript:') || uri.startsWith('data:')) {
      //   return NextResponse.json({ success: false, message: "Invalid URI format" }, { status: 400 });
      // }
    });

    test("SECURITY GAP: does NOT validate URI format before external API call", async () => {
      // No URI format validation - could allow malformed URIs to reach external service
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createFailedValidateUriResponse("Invalid domain format")
      );

      const malformedUri = "not-a-valid-uri@#$%";
      const request = TestHelpers.createGetRequest(malformedUri);
      const response = await GET(request);

      // Passes malformed URI without validation
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(malformedUri);
    });

    test("SECURITY GAP: does NOT prevent SSRF attacks via malicious URIs", async () => {
      // CRITICAL: No SSRF protection - could be used to scan internal networks
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const ssrfUri = "localhost:8080";
      const request = TestHelpers.createGetRequest(ssrfUri);
      const response = await GET(request);

      // Currently allows potential SSRF targets
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(ssrfUri);
      
      // RECOMMENDATION: Implement URI whitelist validation:
      // const allowedDomains = ['.sphinx.chat', '.example.com'];
      // if (!allowedDomains.some(domain => uri.endsWith(domain))) {
      //   return NextResponse.json({ success: false, message: "Domain not allowed" }, { status: 400 });
      // }
    });

    test("SECURITY GAP: does NOT escape special characters in URI", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const uriWithSpecialChars = "test<script>alert('xss')</script>.sphinx.chat";
      const request = TestHelpers.createGetRequest(uriWithSpecialChars);
      const response = await GET(request);

      // No escaping or sanitization applied
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(uriWithSpecialChars);
    });
  });

  describe("Service Integration", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should call SwarmService.validateUri with correct parameters", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const uri = "test-swarm.sphinx.chat";
      const request = TestHelpers.createGetRequest(uri);
      await GET(request);

      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(uri);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledTimes(1);
    });

    test("should instantiate SwarmService with correct config", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      await GET(request);

      expect(mockGetServiceConfig).toHaveBeenCalledWith("swarm");
      expect(mockSwarmService).toHaveBeenCalledWith({
        baseURL: "https://swarm-superadmin.example.com",
        apiKey: "test-super-admin-key",
        timeout: 120000,
        headers: {
          "Content-Type": "application/json",
        },
      });
    });

    test("should return ValidateUriResponse with domain_exists flag", async () => {
      const mockResponse = TestDataFactory.createValidateUriResponse({
        domain_exists: true,
        swarm_name_exist: false,
      });
      mockSwarmServiceInstance.validateUri.mockResolvedValue(mockResponse);

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectSuccessfulResponse(response, {
        domain_exists: true,
        swarm_name_exist: false,
      });
    });

    test("should return ValidateUriResponse with swarm_name_exist flag", async () => {
      const mockResponse = TestDataFactory.createValidateUriResponse({
        domain_exists: true,
        swarm_name_exist: true,
      });
      mockSwarmServiceInstance.validateUri.mockResolvedValue(mockResponse);

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectSuccessfulResponse(response, {
        domain_exists: true,
        swarm_name_exist: true,
      });
    });

    test("should handle domain not found response", async () => {
      const mockResponse = TestDataFactory.createValidateUriResponse({
        domain_exists: false,
        swarm_name_exist: false,
      });
      mockSwarmServiceInstance.validateUri.mockResolvedValue(mockResponse);

      const request = TestHelpers.createGetRequest("nonexistent-swarm.sphinx.chat");
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data?.domain_exists).toBe(false);
      expect(data.data?.swarm_name_exist).toBe(false);
    });

    test("should handle swarm name not found response", async () => {
      const mockResponse = TestDataFactory.createValidateUriResponse({
        domain_exists: true,
        swarm_name_exist: false,
      });
      mockSwarmServiceInstance.validateUri.mockResolvedValue(mockResponse);

      const request = TestHelpers.createGetRequest("valid-domain-no-swarm.sphinx.chat");
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data?.domain_exists).toBe(true);
      expect(data.data?.swarm_name_exist).toBe(false);
    });

    test("should handle external API timeouts gracefully", async () => {
      mockSwarmServiceInstance.validateUri.mockRejectedValue(new Error("Request timeout"));

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 500, "Failed to validate uri");
    });

    test("should handle 500 errors from Super Admin API", async () => {
      mockSwarmServiceInstance.validateUri.mockRejectedValue(
        new Error("Super Admin API internal error")
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 500, "Failed to validate uri");
    });
  });

  describe("Response Format", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 200 status on successful validation", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should match ValidateUriResponse interface shape", async () => {
      const mockResponse = TestDataFactory.createValidateUriResponse({
        domain_exists: true,
        swarm_name_exist: true,
      });
      mockSwarmServiceInstance.validateUri.mockResolvedValue(mockResponse);

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      const data = await response.json();
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("data");
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.message).toBe("string");
      
      if (data.data) {
        expect(data.data).toHaveProperty("domain_exists");
        expect(data.data).toHaveProperty("swarm_name_exist");
        expect(typeof data.data.domain_exists).toBe("boolean");
        expect(typeof data.data.swarm_name_exist).toBe("boolean");
      }
    });

    test("should handle null data in ValidateUriResponse", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createFailedValidateUriResponse("Validation failed")
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Validation failed");
      expect(data.data).toBeNull();
    });

    test("should not expose sensitive data in error messages", async () => {
      mockSwarmServiceInstance.validateUri.mockRejectedValue(
        new Error("Internal error: API key xyz123 invalid")
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      const responseText = await response.text();
      expect(responseText).not.toContain("API key");
      expect(responseText).not.toContain("xyz123");
      expect(responseText).toContain("Failed to validate uri");
    });

    test("should not expose internal error details", async () => {
      mockSwarmServiceInstance.validateUri.mockRejectedValue(
        new Error("Database connection failed at 192.168.1.10:5432")
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      const data = await response.json();
      expect(data.message).toBe("Failed to validate uri");
      expect(JSON.stringify(data)).not.toContain("192.168.1.10");
      expect(JSON.stringify(data)).not.toContain("5432");
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 500 when unexpected error occurs", async () => {
      mockSwarmServiceInstance.validateUri.mockRejectedValue(
        new Error("Unexpected error")
      );

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 500, "Failed to validate uri");
    });

    test("should handle SwarmService instantiation failure", async () => {
      mockSwarmService.mockImplementation(() => {
        throw new Error("Failed to initialize SwarmService");
      });

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 500, "Failed to validate uri");
    });

    test("should handle getServiceConfig failure", async () => {
      mockGetServiceConfig.mockImplementation(() => {
        throw new Error("Service config not found");
      });

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      await TestHelpers.expectValidationError(response, 500, "Failed to validate uri");
    });

    test("should handle malformed ValidateUriResponse from service", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue({
        // Missing required fields
        incomplete: true,
      } as any);

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      // Should still return 200 even with malformed response
      expect(response.status).toBe(200);
      const data = await response.json();
      
      // With malformed response, the route passes undefined values to NextResponse.json()
      // which results in properties being undefined/missing in the response
      expect(data.success).toBeUndefined();
      expect(data.message).toBeUndefined();
      expect(data.data).toBeUndefined();
    });

    test("should handle undefined response from service", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(undefined);

      const request = TestHelpers.createGetRequest("test-swarm.sphinx.chat");
      const response = await GET(request);

      // When service returns undefined, accessing properties causes an error
      // which triggers the catch block and returns 500
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to validate uri");
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should handle extremely long URI", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const longUri = "a".repeat(1000) + ".sphinx.chat";
      const request = TestHelpers.createGetRequest(longUri);
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(longUri);
    });

    test("should handle URI with URL encoding", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const encodedUri = "test%20swarm.sphinx.chat";
      const request = TestHelpers.createGetRequest(encodedUri);
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should handle URI with query parameters", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const uriWithParams = "test-swarm.sphinx.chat?version=1&mode=prod";
      const request = TestHelpers.createGetRequest(uriWithParams);
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledWith(uriWithParams);
    });

    test("should handle concurrent requests", async () => {
      mockSwarmServiceInstance.validateUri.mockResolvedValue(
        TestDataFactory.createValidateUriResponse()
      );

      const requests = Array.from({ length: 10 }, (_, i) =>
        TestHelpers.createGetRequest(`swarm-${i}.sphinx.chat`)
      );

      const responses = await Promise.all(requests.map((req) => GET(req)));

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      expect(mockSwarmServiceInstance.validateUri).toHaveBeenCalledTimes(10);
    });
  });
});