import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/services/ec2", () => ({
  describeInstance: vi.fn(),
}));

import { GET } from "@/app/api/admin/swarms/[instanceId]/route";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { describeInstance } from "@/services/ec2";

const mockDb = db as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
};
const mockDescribeInstance = describeInstance as ReturnType<typeof vi.fn>;

const SUPER_ADMIN_USER_ID = "user-super-admin";
const INSTANCE_ID = "i-037590bbc955c5585";

const INSTANCE = {
  instanceId: INSTANCE_ID,
  name: "prod-node-1",
  state: "running",
  instanceType: "t3.medium",
  launchTime: new Date("2026-01-01T00:00:00Z"),
  tags: [
    { key: "Swarm", value: "superadmin" },
    { key: "UserAssignedName", value: "prod-node-1" },
  ],
  publicIp: "1.2.3.4",
  privateIp: "10.0.0.1",
  hiveWorkspace: null,
};

function makeRequest(userId: string | null, instanceId = INSTANCE_ID): NextRequest {
  const headers: Record<string, string> = {};
  if (userId) {
    headers[MIDDLEWARE_HEADERS.USER_ID] = userId;
  }
  return new NextRequest(`http://localhost/api/admin/swarms/${instanceId}`, {
    method: "GET",
    headers,
  });
}

const params = { params: Promise.resolve({ instanceId: INSTANCE_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/swarms/[instanceId]", () => {
  it("returns 401 when no user header and does not call AWS", async () => {
    const res = await GET(makeRequest(null), params);
    expect(res.status).toBe(401);
    expect(mockDescribeInstance).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not SUPER_ADMIN and does not call AWS", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const res = await GET(makeRequest(SUPER_ADMIN_USER_ID), params);
    expect(res.status).toBe(403);
    expect(mockDescribeInstance).not.toHaveBeenCalled();
  });

  it("returns 200 with the instance body for a valid superadmin instance", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockDescribeInstance.mockResolvedValue(INSTANCE);

    const res = await GET(makeRequest(SUPER_ADMIN_USER_ID), params);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.instanceId).toBe(INSTANCE_ID);
    expect(body.tags).toContainEqual({ key: "UserAssignedName", value: "prod-node-1" });
    expect(mockDescribeInstance).toHaveBeenCalledWith(INSTANCE_ID);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it("returns 404 when describeInstance returns null", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockDescribeInstance.mockResolvedValue(null);

    const res = await GET(makeRequest(SUPER_ADMIN_USER_ID), params);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Instance not found");
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("returns 500 only on unexpected AWS errors", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockDescribeInstance.mockRejectedValue(new Error("AccessDenied"));

    const res = await GET(makeRequest(SUPER_ADMIN_USER_ID), params);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Failed to fetch instance");
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("never reads redis", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockDescribeInstance.mockResolvedValue(INSTANCE);

    await GET(makeRequest(SUPER_ADMIN_USER_ID), params);

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.setex).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
