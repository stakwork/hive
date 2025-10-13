import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/super/new_swarm/route";
import { createPostRequest, expectSuccess } from "@/__tests__/support/helpers";

describe("POST /api/super/new_swarm Integration Tests", () => {
  const superAdminKey = "test-super-admin-key";

  beforeEach(() => {
    process.env.SWARM_SUPERADMIN_API_KEY = superAdminKey;
  });

  it("should create a new swarm with a valid super token", async () => {
    const request = createPostRequest("/api/super/new_swarm", {
      instance_type: "t2.medium",
      password: "a-secure-password",
    });
    request.headers.set("x-super-token", superAdminKey);

    const response = await POST(request);
    const data = await expectSuccess(response, 200);

    expect(data.success).toBe(true);
    expect(data.message).toBe("Swarm created successfully");
    expect(data.data).toBeDefined();
    expect(data.data.swarm_id).toBeDefined();
    expect(data.data.address).toBeDefined();
    expect(data.data.x_api_key).toBeDefined();
    expect(data.data.ec2_id).toBeDefined();
  });

  it("should return 401 Unauthorized if x-super-token is missing", async () => {
    const request = createPostRequest("/api/super/new_swarm", {
      instance_type: "t2.medium",
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Unauthorized");
  });

  it("should return 401 Unauthorized if x-super-token is invalid", async () => {
    const request = createPostRequest("/api/super/new_swarm", {
      instance_type: "t2.medium",
    });
    request.headers.set("x-super-token", "invalid-token");

    const response = await POST(request);
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Unauthorized");
  });

  it("should return 400 Bad Request if instance_type is missing", async () => {
    const request = createPostRequest("/api/super/new_swarm", {
      // instance_type is missing
      password: "a-secure-password",
    });
    request.headers.set("x-super-token", superAdminKey);

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Missing required field: instance_type");
  });
});