import { describe, it, expect, beforeEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { createTestUser } from "@/__tests__/support/factories";
import {
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers/request-builders";

// Mock Redis to avoid real Redis connections
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
  },
}));

// Mock swarm service dependencies
vi.mock("@/services/swarm/api/swarm", () => ({
  fetchSwarmCredentials: vi.fn(),
}));

vi.mock("@/services/swarm/cmd", () => ({
  getSwarmCmdJwt: vi.fn(),
  swarmCmdRequest: vi.fn(),
}));

const INSTANCE_ID = "i-037590bbc955c5585";
const USER_ASSIGNED_NAME = "my-swarm-node";
const EXPECTED_SWARM_URL = `https://${USER_ASSIGNED_NAME}.sphinx.chat`;

const CACHED_INSTANCES = [
  {
    instanceId: INSTANCE_ID,
    name: "my-swarm-node",
    state: "running",
    tags: [
      { key: "Swarm", value: "superadmin" },
      { key: "UserAssignedName", value: USER_ASSIGNED_NAME },
    ],
  },
];

const VALID_CMD = { type: "GetConfig" };

describe("POST /api/admin/swarms/[instanceId]/cmd", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: UserRole.SUPER_ADMIN,
      email: `superadmin-cmd-${Date.now()}@test.com`,
    });
    regularUser = await createTestUser({
      role: UserRole.USER,
      email: `regular-cmd-${Date.now()}@test.com`,
    });

    // Reset mocks
    vi.clearAllMocks();

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");

    vi.mocked(fetchSwarmCredentials).mockResolvedValue({
      username: "admin",
      password: "secret",
    });
    vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
    vi.mocked(swarmCmdRequest).mockResolvedValue({ success: true });
  });

  it("Case 1: swarmUrl provided in body — used directly, Redis not read", async () => {
    const providedUrl = "https://custom-swarm.sphinx.chat";
    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: providedUrl }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);

    const { redis } = await import("@/lib/redis");
    expect(redis.get).not.toHaveBeenCalled();

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      providedUrl,
      "secret",
      "admin"
    );

    const { swarmCmdRequest } = await import("@/services/swarm/cmd");
    expect(vi.mocked(swarmCmdRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: providedUrl })
    );
  });

  it("Case 2: swarmUrl absent, cache hit with UserAssignedName tag — URL constructed correctly", async () => {
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(CACHED_INSTANCES));

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);
    expect(redis.get).toHaveBeenCalledWith("admin:swarms:list");

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      EXPECTED_SWARM_URL,
      "secret",
      "admin"
    );

    const { swarmCmdRequest } = await import("@/services/swarm/cmd");
    expect(vi.mocked(swarmCmdRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: EXPECTED_SWARM_URL })
    );
  });

  it("Case 3: swarmUrl absent, Redis cache miss — returns 400 with descriptive error", async () => {
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.get).mockResolvedValue(null);

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/cache may be cold or UserAssignedName tag is missing/);
  });

  it("Case 4: swarmUrl absent, cache hit but no UserAssignedName tag — returns 400", async () => {
    const { redis } = await import("@/lib/redis");
    const instancesWithoutTag = [
      {
        instanceId: INSTANCE_ID,
        name: "my-swarm-node",
        state: "running",
        tags: [{ key: "Swarm", value: "superadmin" }],
      },
    ];
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(instancesWithoutTag));

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/cache may be cold or UserAssignedName tag is missing/);
  });

  it("Case 5: Non-superadmin user — returns 403", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      regularUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(403);
  });

  it("Case 6: Missing cmd field — returns 400", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/Missing or invalid 'cmd' field/);
  });
});
