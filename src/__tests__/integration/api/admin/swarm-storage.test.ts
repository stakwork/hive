import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/host-storage.contract.json";
import { createTestUser } from "@/__tests__/support/factories";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import {
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers";

// ---------------------------------------------------------------------------
// Mocks: the outbound swarm network boundary and Redis (in-memory fake).
// The route, requireSuperAdmin, readHostStorage, encryption (real envelopes via
// the swarm factory) and the real parser all run for real — these tests pin the
// route's auth gate and the outcome → HTTP mapping end to end.
// ---------------------------------------------------------------------------

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

/** The pinned contract body with errors[] emptied — a clean OK reading. */
function cleanContractBody(): Body {
  const body = clone(contractFixture);
  body.errors = [];
  return body;
}

function okCmdResponse(data: unknown): SwarmCmdResponse {
  return { ok: true, status: 200, data, rawText: undefined };
}

function timeoutResponse(): SwarmCmdResponse {
  return { ok: false, status: 0, data: null, rawText: "", errorCode: "TIMEOUT" };
}

function freshEc2Id(): string {
  // EC2 ids are `i-` + hex; coerce a unique id into that shape.
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
    name: options.name ?? `storage-route-${generateUniqueId()}`,
    swarmUrl: options.swarmUrl ?? "https://storage-route.sphinx.chat",
    ...(options.swarmPassword === null
      ? {}
      : { swarmPassword: options.swarmPassword ?? "test-swarm-password" }),
    ec2Id: options.ec2Id,
  });
}

async function importRoute() {
  const { GET } = await import("@/app/api/admin/swarms/[instanceId]/storage/route");
  return GET;
}

describe("GET /api/admin/swarms/[instanceId]/storage", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: UserRole.SUPER_ADMIN,
      email: `superadmin-storage-${Date.now()}@test.com`,
    });
    regularUser = await createTestUser({
      role: UserRole.USER,
      email: `regular-storage-${Date.now()}@test.com`,
    });

    vi.clearAllMocks();
    redisStore.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse(cleanContractBody()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("non-super-admin gets 403 with no credential decryption or outbound swarm call", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/storage`,
      regularUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");

    // No side effects: no swarm login, no cmd round-trip, no cooldown write.
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
    expect(redisStore.size).toBe(0);
  });

  test("malformed instanceId gets 400 without any outbound swarm call", async () => {
    const GET = await importRoute();

    for (const bad of ["not-an-id", "i-", "i-XYZ", ""]) {
      const request = createAuthenticatedGetRequest(
        `/api/admin/swarms/${bad}/storage`,
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
    const ec2Id = freshEc2Id(); // no swarm rows created

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/storage`,
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
      `/api/admin/swarms/${ec2Id}/storage`,
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
      `/api/admin/swarms/${ec2Id}/storage`,
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
    expect(body.reading.source).toBe("node_exporter");
    expect(body.collectedAt).toBe(cleanContractBody().collected_at);
    expect(mockGetJwt).toHaveBeenCalledWith(
      "https://storage-route.sphinx.chat",
      "test-swarm-password",
      "admin",
      expect.any(Number),
    );
  });

  test("a second call within the cooldown returns the cached reading with its original collectedAt", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const url = `/api/admin/swarms/${ec2Id}/storage`;
    const first = await GET(createAuthenticatedGetRequest(url, superAdminUser) as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).outcome).toBe("fresh");

    // Change what the swarm would answer — the cooldown must NOT re-poll.
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const second = await GET(createAuthenticatedGetRequest(url, superAdminUser) as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.outcome).toBe("cached");
    expect(body.cached).toBe(true);
    expect(body.collectedAt).toBe(cleanContractBody().collected_at);
    expect(mockCmdRequest).toHaveBeenCalledTimes(1); // no second outbound call
  });

  test("a swarmUrl supplied via the query string is ignored in favour of the DB value", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    const dbUrl = "https://storage-route.sphinx.chat";
    await createSwarmForInstance({ ec2Id, swarmUrl: dbUrl });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/storage`,
      superAdminUser,
      { swarmUrl: "https://evil.example.com" },
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("fresh");
    // The outbound call went to the DB-resolved URL, never the query-string one.
    expect(mockCmdRequest).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: dbUrl }),
    );
    expect(mockCmdRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: "https://evil.example.com" }),
    );
  });

  test("an unreachable swarm returns 200 with the outcome and reason code (not a blank error)", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/storage`,
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
      `/api/admin/swarms/${ec2Id}/storage`,
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

  test("the JSON response round-trips (no BigInt serialization failure)", async () => {
    const GET = await importRoute();
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const request = createAuthenticatedGetRequest(
      `/api/admin/swarms/${ec2Id}/storage`,
      superAdminUser,
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ instanceId: ec2Id }),
    });

    // JSON.parse throws if the body contained a BigInt-produced invalid JSON.
    const body = await response.json();
    expect(typeof body.reading.governingFilesystem.freeBytes).toBe("number");
  });
});
