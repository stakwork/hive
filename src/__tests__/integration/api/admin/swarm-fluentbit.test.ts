import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/fluentbit-stats.contract.json";
import { createTestUser } from "@/__tests__/support/factories";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers";

const mockGetJwt = vi.hoisted(() => vi.fn());
const mockCmdRequest = vi.hoisted(() => vi.fn());
const redisStore = vi.hoisted(() => new Map<string, string>());

vi.mock("@/services/swarm/cmd", () => ({
  SwarmCmdConfigError: class SwarmCmdConfigError extends Error {
    readonly code = "CONFIG_INVALID";
    constructor(message = "CONFIG_INVALID") {
      super(message);
      this.name = "SwarmCmdConfigError";
    }
  },
  SwarmAuthError: class SwarmAuthError extends Error {
    readonly status: number;
    constructor(status: number) {
      super(`Swarm login failed (${status})`);
      this.name = "SwarmAuthError";
      this.status = status;
    }
  },
  getSwarmCmdJwt: mockGetJwt,
  swarmCmdRequest: mockCmdRequest,
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      redisStore.set(key, value);
    }),
  },
}));

type Body = Record<string, unknown>;

function clone(obj: unknown): Body {
  return JSON.parse(JSON.stringify(obj)) as Body;
}

function okCmdResponse(data: unknown): SwarmCmdResponse {
  return { ok: true, status: 200, data, rawText: undefined };
}

function timeoutResponse(): SwarmCmdResponse {
  return { ok: false, status: 0, data: null, rawText: "", errorCode: "TIMEOUT" };
}

function freshEc2Id(): string {
  return `i-${generateUniqueId().replace(/[^0-9a-f]/g, "0")}`;
}

async function createSwarmForInstance(options: {
  ec2Id: string;
  swarmUrl?: string;
  swarmPassword?: string | null;
  name?: string;
}) {
  const { workspace } = await createTestWorkspaceScenario({});
  return createTestSwarm({
    workspaceId: workspace.id,
    name: options.name ?? `fluentbit-route-${generateUniqueId()}`,
    swarmUrl: options.swarmUrl ?? "https://fluentbit-route.sphinx.chat",
    ...(options.swarmPassword === null
      ? {}
      : { swarmPassword: options.swarmPassword ?? "test-swarm-password" }),
    ec2Id: options.ec2Id,
  });
}

async function importRoute() {
  const { GET } = await import("@/app/api/admin/swarms/[instanceId]/fluentbit/route");
  return GET;
}

describe("GET /api/admin/swarms/[instanceId]/fluentbit", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: UserRole.SUPER_ADMIN,
      email: `superadmin-fluentbit-${Date.now()}@test.com`,
    });
    regularUser = await createTestUser({
      role: UserRole.USER,
      email: `regular-fluentbit-${Date.now()}@test.com`,
    });

    vi.clearAllMocks();
    redisStore.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse(clone(contractFixture)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("non-super-admin gets 403 with no outbound call and no cooldown write", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      regularUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");

    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
    expect(redisStore.size).toBe(0);
  });

  test("malformed instanceId gets 400 without any outbound swarm call", async () => {
    const GET = await importRoute();

    for (const bad of ["not-an-id", "i-", "i-XYZ", ""]) {
      const request = createAuthenticatedGetRequest(
        `/api/admin/swarms/${bad}/fluentbit`,
        superAdminUser,
      );
      const response = await GET(request as never, {
        params: Promise.resolve({ instanceId: bad }),
      });

      expect(response.status, `expected 400 for "${bad}"`).toBe(400);
      const body = await response.json();
      expect(body.outcome).toBe("failed");
      expect(body.reasonCode).toBe("INVALID_INSTANCE_ID");
    }

    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("instance with zero matching Swarm rows returns the distinguishable no_swarm_record state (200)", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("no_swarm_record");
    expect(body.reasonCode).toBe("NO_SWARM_RECORD");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("more than one matching Swarm row returns 409 rather than an arbitrary row", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id, name: `dup-a-${generateUniqueId()}` });
    await createSwarmForInstance({ ec2Id, name: `dup-b-${generateUniqueId()}` });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.outcome).toBe("ambiguous");
    expect(body.reasonCode).toBe("AMBIGUOUS");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("successful read returns 200 with the normalised reading (outcome fresh)", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("fresh");
    expect(body.cached).toBe(false);
    expect(body.reading.status).toBe("OK");
    expect(body.reading.inputBytes).toBe(12345);
    expect(body.reading.rates.inputBytesPerSec).toBeNull();
    expect(body.collectedAt).toBe(clone(contractFixture).collected_at);
    expect(mockGetJwt).toHaveBeenCalledWith(
      "https://fluentbit-route.sphinx.chat",
      "test-swarm-password",
      "admin",
      18_000,
    );
  });

  test("a second call within the cooldown returns the cached reading with baked-in rates and only one outbound cmd call", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const url = `/api/admin/swarms/${ec2Id}/fluentbit`;
    const first = await GET(createAuthenticatedGetRequest(url, superAdminUser) as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.outcome).toBe("fresh");
    expect(firstBody.reading.rateWindowSeconds).toBeNull();

    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const second = await GET(createAuthenticatedGetRequest(url, superAdminUser) as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.outcome).toBe("cached");
    expect(body.cached).toBe(true);
    expect(body.collectedAt).toBe(clone(contractFixture).collected_at);
    expect(body.reading.rates).toEqual(firstBody.reading.rates);
    expect(body.reading.rateWindowSeconds).toBe(firstBody.reading.rateWindowSeconds);
    expect(mockCmdRequest).toHaveBeenCalledTimes(1);
  });

  test("a swarmUrl supplied via the query string is ignored in favour of the DB value", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    const dbUrl = "https://fluentbit-route.sphinx.chat";
    await createSwarmForInstance({ ec2Id, swarmUrl: dbUrl });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
      { swarmUrl: "https://evil.example.com" },
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("fresh");
    expect(mockCmdRequest).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: dbUrl }),
    );
    expect(mockCmdRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: "https://evil.example.com" }),
    );
  });

  test("an unreachable swarm returns 200 with the outcome and reason code (not fabricated data)", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("unreachable");
    expect(body.reasonCode).toBe("TIMEOUT");
    expect(body.reading).toBeUndefined();
  });

  test("a swarm without credentials returns 200 with outcome failed and CONFIG_INVALID", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id, swarmPassword: null });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/fluentbit`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("failed");
    expect(body.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });
});
