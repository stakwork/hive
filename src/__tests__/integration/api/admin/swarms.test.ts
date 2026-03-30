import { describe, it, expect, beforeEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { createTestUser } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";

// Mock Redis to avoid real Redis connections
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock EC2 service
vi.mock("@/services/ec2", () => ({
  listSuperadminInstances: vi.fn(),
  startInstance: vi.fn(),
  stopInstance: vi.fn(),
}));

const FAKE_INSTANCES = [
  {
    instanceId: "i-mock0000000001",
    name: "swarm-node-1",
    state: "running",
    instanceType: "t3.medium",
    launchTime: "2026-01-01T00:00:00.000Z",
    tags: [{ key: "Swarm", value: "superadmin" }],
  },
  {
    instanceId: "i-mock0000000004",
    name: "swarm-node-4",
    state: "stopped",
    instanceType: "t3.medium",
    launchTime: "2026-01-04T00:00:00.000Z",
    tags: [{ key: "Swarm", value: "superadmin" }],
  },
];

describe("Admin Swarms API", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: UserRole.SUPER_ADMIN,
      email: "superadmin@test.com",
    });
    regularUser = await createTestUser({
      role: UserRole.USER,
      email: "regular@test.com",
    });
  });

  describe("GET /api/admin/swarms", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = createGetRequest("/api/admin/swarms");
      const { GET } = await import("@/app/api/admin/swarms/route");
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it("returns 403 for non-superadmin users", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/swarms",
        regularUser
      );
      const { GET } = await import("@/app/api/admin/swarms/route");
      const response = await GET(request);
      expect(response.status).toBe(403);
    });

    it("returns cached data on cache hit without calling listSuperadminInstances", async () => {
      const { redis } = await import("@/lib/redis");
      const { listSuperadminInstances } = await import("@/services/ec2");

      vi.mocked(redis.get).mockResolvedValueOnce(
        JSON.stringify(FAKE_INSTANCES)
      );

      const request = createAuthenticatedGetRequest(
        "/api/admin/swarms",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/swarms/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual(FAKE_INSTANCES);
      expect(listSuperadminInstances).not.toHaveBeenCalled();
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it("calls listSuperadminInstances and caches result on cache miss", async () => {
      const { redis } = await import("@/lib/redis");
      const { listSuperadminInstances } = await import("@/services/ec2");

      vi.mocked(redis.get).mockResolvedValueOnce(null);
      vi.mocked(listSuperadminInstances).mockResolvedValueOnce(FAKE_INSTANCES as any);
      vi.mocked(redis.setex).mockResolvedValueOnce("OK");

      const request = createAuthenticatedGetRequest(
        "/api/admin/swarms",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/swarms/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual(FAKE_INSTANCES);
      expect(listSuperadminInstances).toHaveBeenCalledOnce();
      expect(redis.setex).toHaveBeenCalledWith(
        "admin:swarms:list",
        60,
        JSON.stringify(FAKE_INSTANCES)
      );
    });
  });

  describe("POST /api/admin/swarms/[instanceId]/action", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = new Request(
        "http://localhost/api/admin/swarms/i-mock0000000001/action",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        }
      );
      const { POST } = await import(
        "@/app/api/admin/swarms/[instanceId]/action/route"
      );
      const response = await POST(request as any, {
        params: Promise.resolve({ instanceId: "i-mock0000000001" }),
      });
      expect(response.status).toBe(401);
    });

    it("returns 403 for non-superadmin users", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/swarms/i-mock0000000001/action",
        regularUser,
        { action: "stop" }
      );
      const { POST } = await import(
        "@/app/api/admin/swarms/[instanceId]/action/route"
      );
      const response = await POST(request, {
        params: Promise.resolve({ instanceId: "i-mock0000000001" }),
      });
      expect(response.status).toBe(403);
    });

    it("returns 400 for invalid action body", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/swarms/i-mock0000000001/action",
        superAdminUser,
        { action: "reboot" }
      );
      const { POST } = await import(
        "@/app/api/admin/swarms/[instanceId]/action/route"
      );
      const response = await POST(request, {
        params: Promise.resolve({ instanceId: "i-mock0000000001" }),
      });
      expect(response.status).toBe(400);
    });

    it("calls stopInstance, busts cache, and returns success for stop action", async () => {
      const { redis } = await import("@/lib/redis");
      const { stopInstance } = await import("@/services/ec2");

      vi.mocked(stopInstance).mockResolvedValueOnce(undefined);
      vi.mocked(redis.del).mockResolvedValueOnce(1);

      const request = createAuthenticatedPostRequest(
        "/api/admin/swarms/i-mock0000000001/action",
        superAdminUser,
        { action: "stop" }
      );
      const { POST } = await import(
        "@/app/api/admin/swarms/[instanceId]/action/route"
      );
      const response = await POST(request, {
        params: Promise.resolve({ instanceId: "i-mock0000000001" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ success: true });
      expect(stopInstance).toHaveBeenCalledWith("i-mock0000000001");
      expect(redis.del).toHaveBeenCalledWith("admin:swarms:list");
    });

    it("calls startInstance, busts cache, and returns success for start action", async () => {
      const { redis } = await import("@/lib/redis");
      const { startInstance } = await import("@/services/ec2");

      vi.mocked(startInstance).mockResolvedValueOnce(undefined);
      vi.mocked(redis.del).mockResolvedValueOnce(1);

      const request = createAuthenticatedPostRequest(
        "/api/admin/swarms/i-mock0000000004/action",
        superAdminUser,
        { action: "start" }
      );
      const { POST } = await import(
        "@/app/api/admin/swarms/[instanceId]/action/route"
      );
      const response = await POST(request, {
        params: Promise.resolve({ instanceId: "i-mock0000000004" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ success: true });
      expect(startInstance).toHaveBeenCalledWith("i-mock0000000004");
      expect(redis.del).toHaveBeenCalledWith("admin:swarms:list");
    });
  });
});
