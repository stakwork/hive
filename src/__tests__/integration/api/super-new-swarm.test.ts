import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/super/new_swarm/route";
import {
  createPostRequest,
  expectSuccess,
} from "@/__tests__/support/helpers";
import { env } from "@/lib/env";

describe("POST /api/super/new_swarm Integration Tests", () => {
  const superAdminToken = "super-secret-test-token";

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up the environment variable for the test
    env.SWARM_SUPERADMIN_API_KEY = superAdminToken;
  });

  describe("Authentication", () => {
    test("should return 401 Unauthorized if x-super-token is missing", async () => {
      const request = createPostRequest("/api/super/new_swarm", {
        instance_type: "t2.medium",
      });
      // No token in header

      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should return 401 Unauthorized if x-super-token is invalid", async () => {
      const request = createPostRequest("/api/super/new_swarm", {
        instance_type: "t2.medium",
      });
      request.headers.set("x-super-token", "invalid-token");

      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    test("should return 400 Bad Request if instance_type is missing", async () => {
      const request = createPostRequest("/api/super/new_swarm", {
        // instance_type is missing
        password: "some-password",
      });
      request.headers.set("x-super-token", superAdminToken);

      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.message).toBe("Invalid request body");
      expect(data.errors.fieldErrors).toHaveProperty("instance_type");
    });
    
    test("should return 400 Bad Request if instance_type is an empty string", async () => {
      const request = createPostRequest("/api/super/new_swarm", {
        instance_type: "",
        password: "some-password",
      });
      request.headers.set("x-super-token", superAdminToken);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toBe("Invalid request body");
      expect(data.errors.fieldErrors).toHaveProperty("instance_type");
    });
  });

  describe("Success Scenarios", () => {
    test("should return 200 OK with swarm details on successful creation", async () => {
      const request = createPostRequest("/api/super/new_swarm", {
        instance_type: "t2.large",
        password: "a-very-secure-password",
      });
      request.headers.set("x-super-token", superAdminToken);

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm created successfully");
      expect(data.data).toEqual({
        swarm_id: expect.stringMatching(/^swarm-/),
        address: expect.stringMatching(/\.example\.com$/),
        x_api_key: expect.stringMatching(/^sk-/),
        ec2_id: expect.stringMatching(/^i-/),
      });
    });

    test("should succeed even if password is not provided", async () => {
        const request = createPostRequest("/api/super/new_swarm", {
          instance_type: "t2.large",
        });
        request.headers.set("x-super-token", superAdminToken);
  
        const response = await POST(request);
        await expectSuccess(response);
      });
  });
  
  describe("Error Handling", () => {
    test("should return 500 if provisioning fails", async () => {
        const request = createPostRequest("/api/super/new_swarm", {
            instance_type: "fail_provisioning", // Special value to trigger error in mock
        });
        request.headers.set("x-super-token", superAdminToken);

        const response = await POST(request);
        const data = await response.json();
        
        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Failed to provision EC2 instance");
    });
  });
});