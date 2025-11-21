import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/super/new_swarm/route";
import { createRequestWithHeaders, expectSuccess, expectUnauthorized, expectError } from "@/__tests__/support/helpers";

/**
 * Integration tests for POST /api/super/new_swarm
 *
 * ⚠️ IMPORTANT: These tests are disabled because the endpoint is a stub implementation.
 * The route at /api/super/new_swarm/route.ts needs to be fully implemented before these tests can pass.
 *
 * The endpoint implementation should:
 * - Authenticate via x-super-token header (validated against SWARM_SUPERADMIN_API_KEY)
 * - Validate CreateSwarmRequest payload (instance_type required, password optional)
 * - Return CreateSwarmResponse with swarm details (swarm_id, address, x_api_key, ec2_id)
 * - Handle errors for missing/invalid tokens and malformed requests
 *
 * TODO: Implement /api/super/new_swarm/route.ts endpoint, then uncomment these tests
 */
describe.skip("POST /api/super/new_swarm Integration Tests", () => {
  const VALID_SUPER_TOKEN = "super"; // From TEST_ENV_DEFAULTS in src/__tests__/setup/env.ts
  const INVALID_SUPER_TOKEN = "invalid-token";

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure test environment has SWARM_SUPERADMIN_API_KEY set
    process.env.SWARM_SUPERADMIN_API_KEY = VALID_SUPER_TOKEN;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should accept request with valid x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
          password: "securePass123",
        },
      );

      const response = await POST(request);

      // Verify successful response
      await expectSuccess(response);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("swarm_id");
      expect(data.data).toHaveProperty("address");
      expect(data.data).toHaveProperty("x_api_key");
      expect(data.data).toHaveProperty("ec2_id");
    });

    test("should reject request with missing x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          // No x-super-token header
        },
        {
          instance_type: "t2.medium",
        },
      );

      const response = await POST(request);

      await expectUnauthorized(response);

      const data = await response.json();
      expect(data.error || data.message).toMatch(/unauthorized|missing.*token/i);
    });

    test("should reject request with invalid x-super-token header", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": INVALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
        },
      );

      const response = await POST(request);

      await expectUnauthorized(response);

      const data = await response.json();
      expect(data.error || data.message).toMatch(/unauthorized|invalid.*token/i);
    });

    test("should return 500 when SWARM_SUPERADMIN_API_KEY is not configured", async () => {
      // Remove API key from environment to simulate misconfiguration
      const originalKey = process.env.SWARM_SUPERADMIN_API_KEY;
      delete process.env.SWARM_SUPERADMIN_API_KEY;

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": "any-token",
        },
        {
          instance_type: "t2.medium",
        },
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error || data.message).toMatch(/not configured|missing.*configuration/i);

      // Restore original value
      process.env.SWARM_SUPERADMIN_API_KEY = originalKey;
    });
  });

  describe("Request Validation", () => {
    test("should accept valid request with required instance_type", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
        },
      );

      const response = await POST(request);

      await expectSuccess(response);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should accept valid request with optional password", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.large",
          password: "customPassword123",
        },
      );

      const response = await POST(request);

      await expectSuccess(response);
    });

    test("should reject request with missing instance_type", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          password: "securePass123",
          // Missing instance_type
        },
      );

      const response = await POST(request);

      await expectError(response, "instance_type is required", 400);
    });

    test("should reject request with invalid instance_type type", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: 123, // Should be string
        },
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error || data.message).toMatch(/invalid.*instance_type|type.*error/i);
    });

    test("should reject request with empty instance_type", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "",
        },
      );

      const response = await POST(request);

      await expectError(response, "instance_type cannot be empty", 400);
    });

    test("should handle malformed JSON gracefully", async () => {
      const { NextRequest } = await import("next/server");
      const request = new NextRequest("http://localhost:3000/api/super/new_swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        body: "invalid json{",
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error || data.message).toMatch(/invalid.*json|malformed.*request/i);
    });

    test("should return appropriate error for empty request body", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {},
      );

      const response = await POST(request);

      await expectError(response, "instance_type is required", 400);
    });
  });

  describe("Response Structure", () => {
    test("should return valid CreateSwarmResponse structure", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
          password: "securePass123",
        },
      );

      const response = await POST(request);
      await expectSuccess(response);

      const data = await response.json();

      // Validate response structure matches CreateSwarmResponse interface
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("data");

      expect(typeof data.success).toBe("boolean");
      expect(typeof data.message).toBe("string");
      expect(typeof data.data).toBe("object");

      // Validate nested data object
      expect(data.data).toHaveProperty("swarm_id");
      expect(data.data).toHaveProperty("address");
      expect(data.data).toHaveProperty("x_api_key");
      expect(data.data).toHaveProperty("ec2_id");

      expect(typeof data.data.swarm_id).toBe("string");
      expect(typeof data.data.address).toBe("string");
      expect(typeof data.data.x_api_key).toBe("string");
      expect(typeof data.data.ec2_id).toBe("string");
    });

    test("should return success true and appropriate message", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.micro",
        },
      );

      const response = await POST(request);
      await expectSuccess(response);

      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.message).toBeTruthy();
      expect(data.message.length).toBeGreaterThan(0);
    });

    test("should return non-empty values for all data fields", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.small",
        },
      );

      const response = await POST(request);
      await expectSuccess(response);

      const data = await response.json();

      // Verify all fields have non-empty string values
      expect(data.data.swarm_id).toBeTruthy();
      expect(data.data.address).toBeTruthy();
      expect(data.data.x_api_key).toBeTruthy();
      expect(data.data.ec2_id).toBeTruthy();

      expect(data.data.swarm_id.length).toBeGreaterThan(0);
      expect(data.data.address.length).toBeGreaterThan(0);
      expect(data.data.x_api_key.length).toBeGreaterThan(0);
      expect(data.data.ec2_id.length).toBeGreaterThan(0);
    });
  });

  describe("Different Instance Types", () => {
    test.each([
      { instance_type: "t2.micro", description: "t2.micro instance" },
      { instance_type: "t2.small", description: "t2.small instance" },
      { instance_type: "t2.medium", description: "t2.medium instance" },
      { instance_type: "t2.large", description: "t2.large instance" },
      { instance_type: "t3.medium", description: "t3.medium instance" },
    ])("should accept valid instance type: $description", async ({ instance_type }) => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        { instance_type },
      );

      const response = await POST(request);

      await expectSuccess(response);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("swarm_id");
    });
  });

  describe("Error Handling", () => {
    test("should handle infrastructure provisioning failures gracefully", async () => {
      // This test assumes the endpoint will handle provisioning errors
      // The actual behavior depends on implementation details
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
        },
      );

      const response = await POST(request);

      // Should either succeed or return appropriate error
      if (!response.ok) {
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error || data.message).toBeTruthy();
      } else {
        await expectSuccess(response);
      }
    });

    test("should handle concurrent swarm creation requests", async () => {
      const requests = Array.from({ length: 3 }, (_, i) =>
        createRequestWithHeaders(
          "http://localhost:3000/api/super/new_swarm",
          "POST",
          {
            "Content-Type": "application/json",
            "x-super-token": VALID_SUPER_TOKEN,
          },
          {
            instance_type: "t2.micro",
            password: `password${i}`,
          },
        ),
      );

      // Execute requests concurrently
      const responses = await Promise.all(requests.map((req) => POST(req)));

      // All requests should succeed
      for (const response of responses) {
        await expectSuccess(response);
      }

      // Verify each swarm has unique identifiers
      const swarmIds = new Set<string>();
      const ec2Ids = new Set<string>();

      for (const response of responses) {
        const data = await response.json();
        swarmIds.add(data.data.swarm_id);
        ec2Ids.add(data.data.ec2_id);
      }

      // Each swarm should have unique IDs
      expect(swarmIds.size).toBe(responses.length);
      expect(ec2Ids.size).toBe(responses.length);
    });
  });

  describe("Password Handling", () => {
    test("should accept request without password", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
          // No password provided
        },
      );

      const response = await POST(request);

      await expectSuccess(response);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should accept request with custom password", async () => {
      const customPassword = "MyCustomPassword123!";

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
          password: customPassword,
        },
      );

      const response = await POST(request);

      await expectSuccess(response);

      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should handle empty password string", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/super/new_swarm",
        "POST",
        {
          "Content-Type": "application/json",
          "x-super-token": VALID_SUPER_TOKEN,
        },
        {
          instance_type: "t2.medium",
          password: "",
        },
      );

      const response = await POST(request);

      // Should either succeed (treating empty as no password) or reject with validation error
      if (!response.ok) {
        const data = await response.json();
        expect(data.error || data.message).toMatch(/password.*empty|invalid.*password/i);
      } else {
        await expectSuccess(response);
      }
    });
  });
});
