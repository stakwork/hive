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

vi.mock("@/services/swarm/cmd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/swarm/cmd")>();
  return {
    ...actual,
    SwarmAuthError: actual.SwarmAuthError,
    SwarmCmdConfigError: actual.SwarmCmdConfigError,
    getSwarmCmdJwt: vi.fn(),
    swarmCmdRequest: vi.fn(),
  };
});

vi.mock("@/services/swarm/cmd-credentials", () => ({
  resolveDbSwarmCredentials: vi.fn(),
}));

const INSTANCE_ID = "i-037590bbc955c5585";
const USER_ASSIGNED_NAME = "my-swarm-node";
const EXPECTED_SWARM_URL = `https://${USER_ASSIGNED_NAME}.sphinx.chat`;
const DB_SWARM_URL = "https://db-swarm-node.sphinx.chat";
const DISALLOWED_SWARM_URL = "https://evil.example.com";

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
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");

    vi.mocked(fetchSwarmCredentials).mockResolvedValue({
      username: "admin",
      password: "secret",
    });
    vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
    vi.mocked(swarmCmdRequest).mockResolvedValue({ success: true } as any);
    // Default: no usable DB credential, so existing happy-path cases
    // deliberately exercise the super-admin fallback path.
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue(null);
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

  it("Case 7: DB-password success — DB creds used, super-admin never called", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DB_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);

    const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      DB_SWARM_URL,
      "db-secret",
      "admin",
      expect.any(Number)
    );
    expect(vi.mocked(swarmCmdRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: DB_SWARM_URL })
    );

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).not.toHaveBeenCalled();
  });

  it("Case 8: DB record missing/ambiguous — falls back to super-admin path", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue(null);

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).toHaveBeenCalledWith(INSTANCE_ID);

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      EXPECTED_SWARM_URL,
      "secret",
      "admin"
    );
  });

  it("Case 9: DB password 401 — falls back to super-admin and succeeds", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DB_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const { getSwarmCmdJwt, SwarmAuthError } = await import("@/services/swarm/cmd");
    vi.mocked(getSwarmCmdJwt).mockImplementation(async (url) => {
      if (url === DB_SWARM_URL) {
        throw new SwarmAuthError(401);
      }
      return "mock-jwt-token";
    });

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).toHaveBeenCalledWith(INSTANCE_ID);
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      EXPECTED_SWARM_URL,
      "secret",
      "admin"
    );
  });

  it("Case 10: DB password non-401 (403) — no fallback, returns 502", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DB_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const { getSwarmCmdJwt, SwarmAuthError } = await import("@/services/swarm/cmd");
    vi.mocked(getSwarmCmdJwt).mockRejectedValue(new SwarmAuthError(403));

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(502);

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).not.toHaveBeenCalled();
  });

  it("Case 11: DB timeout/transport error — no fallback, returns 502", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DB_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.mocked(getSwarmCmdJwt).mockRejectedValue(abortError);

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(502);

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).not.toHaveBeenCalled();

    // Confirms CMD_LOGIN_TIMEOUT_MS is actually wired: a timeoutMs arg is passed.
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      DB_SWARM_URL,
      "db-secret",
      "admin",
      expect.any(Number)
    );
  });

  it("Case 12: DB row host not on allowlist — no DB login attempted, falls back to super-admin", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DISALLOWED_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(200);

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    // Never called with the disallowed DB host.
    expect(vi.mocked(getSwarmCmdJwt)).not.toHaveBeenCalledWith(
      DISALLOWED_SWARM_URL,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(vi.mocked(getSwarmCmdJwt)).toHaveBeenCalledWith(
      EXPECTED_SWARM_URL,
      "secret",
      "admin"
    );

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).toHaveBeenCalledWith(INSTANCE_ID);
  });

  it("Case 13: error message hygiene — auth failure response does not leak raw swarm response text", async () => {
    const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");
    vi.mocked(resolveDbSwarmCredentials).mockResolvedValue({
      swarmUrl: DB_SWARM_URL,
      username: "admin",
      password: "db-secret",
    });

    const { getSwarmCmdJwt, SwarmAuthError } = await import("@/services/swarm/cmd");
    vi.mocked(getSwarmCmdJwt).mockRejectedValue(new SwarmAuthError(500));

    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: EXPECTED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("RAW_SWARM_RESPONSE_MARKER");
    expect(body.error).not.toMatch(/500/);
  });

  it("Case 14: caller-supplied disallowed swarmUrl on the super-admin fallback path — returns 400", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/admin/swarms/${INSTANCE_ID}/cmd`,
      superAdminUser,
      { cmd: VALID_CMD, swarmUrl: DISALLOWED_SWARM_URL }
    );

    const { POST } = await import(
      "@/app/api/admin/swarms/[instanceId]/cmd/route"
    );
    const response = await POST(request as any, {
      params: Promise.resolve({ instanceId: INSTANCE_ID }),
    });

    expect(response.status).toBe(400);

    const { fetchSwarmCredentials } = await import("@/services/swarm/api/swarm");
    expect(vi.mocked(fetchSwarmCredentials)).not.toHaveBeenCalled();
  });
});
