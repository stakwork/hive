import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockSwarmState } from "@/lib/mock/swarm-state";

// Mock the config/env module
vi.mock("@/config/env", () => ({
  env: {
    SWARM_SUPERADMIN_API_KEY: "test-super-token",
  },
  config: {
    SWARM_SUPERADMIN_API_KEY: "test-super-token",
  },
}));

describe("Mock Swarm State Manager", () => {
  beforeEach(() => {
    mockSwarmState.reset();
  });

  afterEach(() => {
    mockSwarmState.reset();
  });

  describe("createSwarm", () => {
    it("should create a swarm with unique IDs", () => {
      const result = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      expect(result).toMatchObject({
        swarm_id: expect.stringContaining("mock-swarm-"),
        ec2_id: expect.stringContaining("i-mock"),
        address: expect.stringContaining(".test.local"),
        x_api_key: expect.stringContaining("mock-api-key-"),
      });
    });

    it("should create multiple swarms with different IDs", () => {
      const swarm1 = mockSwarmState.createSwarm({ instance_type: "t3.small" });
      const swarm2 = mockSwarmState.createSwarm({ instance_type: "t3.medium" });

      expect(swarm1.swarm_id).not.toBe(swarm2.swarm_id);
      expect(swarm1.ec2_id).not.toBe(swarm2.ec2_id);
      expect(swarm1.x_api_key).not.toBe(swarm2.x_api_key);
    });

    it("should use provided password if given", () => {
      const result = mockSwarmState.createSwarm({
        instance_type: "t3.small",
        password: "custom-password",
      });

      const swarm = mockSwarmState.getSwarmDetails(result.swarm_id);
      expect(swarm.password).toBe("custom-password");
    });

    it("should start swarm in PENDING status", () => {
      const result = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      const swarm = mockSwarmState.getSwarmDetails(result.swarm_id);
      expect(swarm.status).toBe("PENDING");
    });

    it("should transition to RUNNING status after delay", async () => {
      const result = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      // Check initial status
      let swarm = mockSwarmState.getSwarmDetails(result.swarm_id);
      expect(swarm.status).toBe("PENDING");

      // Wait for transition (2 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // Check final status
      swarm = mockSwarmState.getSwarmDetails(result.swarm_id);
      expect(swarm.status).toBe("RUNNING");
    });
  });

  describe("getSwarmDetails", () => {
    it("should return swarm details for existing swarm", () => {
      const created = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      const swarm = mockSwarmState.getSwarmDetails(created.swarm_id);

      expect(swarm).toMatchObject({
        swarm_id: created.swarm_id,
        ec2_id: created.ec2_id,
        address: created.address,
        x_api_key: created.x_api_key,
        instance_type: "t3.small",
      });
    });

    it("should auto-create swarm if not found", () => {
      const swarm = mockSwarmState.getSwarmDetails("non-existent-id");

      expect(swarm).toBeDefined();
      expect(swarm.swarm_id).toBeDefined();
      expect(swarm.status).toBe("PENDING");
    });
  });

  describe("stopSwarm", () => {
    it("should stop a running swarm by EC2 ID", async () => {
      const created = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      // Wait for RUNNING status
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const result = mockSwarmState.stopSwarm(created.ec2_id);

      expect(result).toEqual({
        success: true,
        message: "Swarm stopped successfully",
      });

      const swarm = mockSwarmState.getSwarmDetails(created.swarm_id);
      expect(swarm.status).toBe("STOPPED");
    });

    it("should return error for non-existent EC2 ID", () => {
      const result = mockSwarmState.stopSwarm("i-nonexistent");

      expect(result).toEqual({
        success: false,
        message: expect.stringContaining("not found"),
      });
    });

    it("should clear status transition timer when stopping", () => {
      const created = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      // Stop immediately (before transition)
      mockSwarmState.stopSwarm(created.ec2_id);

      const swarm = mockSwarmState.getSwarmDetails(created.swarm_id);
      expect(swarm.status).toBe("STOPPED");
      expect(swarm.statusTransitionTimer).toBeUndefined();
    });
  });

  describe("checkDomain", () => {
    it("should return false for available domain", () => {
      const result = mockSwarmState.checkDomain("new-domain");

      expect(result).toEqual({
        domain_exists: false,
        swarm_name_exist: false,
      });
    });

    it("should return true for existing domain", () => {
      const created = mockSwarmState.createSwarm({
        instance_type: "t3.small",
      });

      const result = mockSwarmState.checkDomain(created.swarm_id);

      expect(result).toEqual({
        domain_exists: true,
        swarm_name_exist: true,
      });
    });

    it("should track multiple domains", () => {
      const swarm1 = mockSwarmState.createSwarm({ instance_type: "t3.small" });
      const swarm2 = mockSwarmState.createSwarm({ instance_type: "t3.medium" });

      expect(mockSwarmState.checkDomain(swarm1.swarm_id)).toEqual({
        domain_exists: true,
        swarm_name_exist: true,
      });

      expect(mockSwarmState.checkDomain(swarm2.swarm_id)).toEqual({
        domain_exists: true,
        swarm_name_exist: true,
      });

      expect(mockSwarmState.checkDomain("unused-domain")).toEqual({
        domain_exists: false,
        swarm_name_exist: false,
      });
    });
  });

  describe("reset", () => {
    it("should clear all swarms", () => {
      mockSwarmState.createSwarm({ instance_type: "t3.small" });
      mockSwarmState.createSwarm({ instance_type: "t3.medium" });

      expect(mockSwarmState.getAllSwarms()).toHaveLength(2);

      mockSwarmState.reset();

      expect(mockSwarmState.getAllSwarms()).toHaveLength(0);
    });

    it("should clear all domains", () => {
      const swarm = mockSwarmState.createSwarm({ instance_type: "t3.small" });

      expect(mockSwarmState.checkDomain(swarm.swarm_id).domain_exists).toBe(
        true
      );

      mockSwarmState.reset();

      expect(mockSwarmState.checkDomain(swarm.swarm_id).domain_exists).toBe(
        false
      );
    });

    it("should reset ID counters", () => {
      mockSwarmState.createSwarm({ instance_type: "t3.small" });
      mockSwarmState.reset();

      const swarm = mockSwarmState.createSwarm({ instance_type: "t3.small" });

      expect(swarm.swarm_id).toBe("mock-swarm-000001");
      expect(swarm.ec2_id).toBe("i-mock0000000001");
    });

    it("should clear all status transition timers", () => {
      mockSwarmState.createSwarm({ instance_type: "t3.small" });
      mockSwarmState.createSwarm({ instance_type: "t3.medium" });

      mockSwarmState.reset();

      // If timers weren't cleared, this would cause issues
      expect(mockSwarmState.getAllSwarms()).toHaveLength(0);
    });
  });

  describe("getAllSwarms", () => {
    it("should return empty array initially", () => {
      expect(mockSwarmState.getAllSwarms()).toHaveLength(0);
    });

    it("should return all created swarms", () => {
      mockSwarmState.createSwarm({ instance_type: "t3.small" });
      mockSwarmState.createSwarm({ instance_type: "t3.medium" });
      mockSwarmState.createSwarm({ instance_type: "t3.large" });

      const swarms = mockSwarmState.getAllSwarms();

      expect(swarms).toHaveLength(3);
      expect(swarms[0].instance_type).toBe("t3.small");
      expect(swarms[1].instance_type).toBe("t3.medium");
      expect(swarms[2].instance_type).toBe("t3.large");
    });
  });
});

describe("Mock Swarm API Endpoints", () => {
  beforeEach(() => {
    mockSwarmState.reset();
  });

  afterEach(() => {
    mockSwarmState.reset();
  });

  describe("POST /api/mock/swarm-super-admin/api/super/new_swarm", () => {
    it("should validate x-super-token header", async () => {
      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/new_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "invalid-token",
        },
        body: JSON.stringify({ instance_type: "t3.small" }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        success: false,
        message: "Unauthorized",
      });
    });

    it("should validate required fields", async () => {
      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/new_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "test-super-token",
        },
        body: JSON.stringify({}),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "Missing required field: instance_type",
      });
    });

    it("should create swarm successfully", async () => {
      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/new_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "test-super-token",
        },
        body: JSON.stringify({
          instance_type: "t3.small",
          password: "test-password",
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        message: "Swarm created successfully",
        data: {
          swarm_id: expect.stringContaining("mock-swarm-"),
          address: expect.stringContaining(".test.local"),
          x_api_key: expect.stringContaining("mock-api-key-"),
          ec2_id: expect.stringContaining("i-mock"),
        },
      });
    });
  });

  describe("POST /api/mock/swarm-super-admin/api/super/stop_swarm", () => {
    it("should validate x-super-token header", async () => {
      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/stop_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "invalid-token",
        },
        body: JSON.stringify({ instance_id: "i-mock123" }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        success: false,
        message: "Unauthorized",
      });
    });

    it("should validate required fields", async () => {
      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/stop_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "test-super-token",
        },
        body: JSON.stringify({}),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "Missing required field: instance_id",
      });
    });

    it("should stop swarm successfully", async () => {
      const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });

      const { POST } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/stop_swarm/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-token": "test-super-token",
        },
        body: JSON.stringify({ instance_id: created.ec2_id }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Swarm stopped successfully",
      });
    });
  });

  describe("GET /api/mock/swarm-super-admin/api/super/check-domain", () => {
    it("should validate x-super-token header", async () => {
      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/check-domain/route"
      );

      const request = new Request(
        "http://localhost/api/mock/swarm?domain=test",
        {
          method: "GET",
          headers: {
            "x-super-token": "invalid-token",
          },
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        success: false,
        message: "Unauthorized",
      });
    });

    it("should validate required parameters", async () => {
      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/check-domain/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "GET",
        headers: {
          "x-super-token": "test-super-token",
        },
      });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        success: false,
        message: "Missing required parameter: domain",
      });
    });

    it("should check domain availability", async () => {
      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/check-domain/route"
      );

      const request = new Request(
        "http://localhost/api/mock/swarm?domain=new-domain",
        {
          method: "GET",
          headers: {
            "x-super-token": "test-super-token",
          },
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Domain check completed",
        data: {
          domain_exists: false,
          swarm_name_exist: false,
        },
      });
    });
  });

  describe("GET /api/mock/swarm-super-admin/api/super/details", () => {
    it("should validate x-super-token header", async () => {
      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/details/route"
      );

      const request = new Request(
        "http://localhost/api/mock/swarm?id=test-id",
        {
          method: "GET",
          headers: {
            "x-super-token": "invalid-token",
          },
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        ok: false,
        data: { message: "Unauthorized" },
        status: 401,
      });
    });

    it("should validate required parameters", async () => {
      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/details/route"
      );

      const request = new Request("http://localhost/api/mock/swarm", {
        method: "GET",
        headers: {
          "x-super-token": "test-super-token",
        },
      });

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        ok: false,
        data: { message: "Missing required parameter: id" },
        status: 400,
      });
    });

    it("should return 400 for PENDING swarms", async () => {
      const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });

      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/details/route"
      );

      const request = new Request(
        `http://localhost/api/mock/swarm?id=${created.swarm_id}`,
        {
          method: "GET",
          headers: {
            "x-super-token": "test-super-token",
          },
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        ok: false,
        data: { message: "Swarm is still starting up" },
        status: 400,
      });
    });

    it("should return swarm details for RUNNING swarms", async () => {
      const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });

      // Wait for transition to RUNNING
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const { GET } = await import(
        "@/app/api/mock/swarm-super-admin/api/super/details/route"
      );

      const request = new Request(
        `http://localhost/api/mock/swarm?id=${created.swarm_id}`,
        {
          method: "GET",
          headers: {
            "x-super-token": "test-super-token",
          },
        }
      );

      const response = await GET(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        data: {
          swarm_id: created.swarm_id,
          address: created.address,
          x_api_key: created.x_api_key,
          ec2_id: created.ec2_id,
          instance_type: "t3.small",
          status: "RUNNING",
        },
        status: 200,
      });
    });
  });
});