import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { UserRole } from "@prisma/client";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/host-storage.contract.json";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import { generateUniqueId } from "@/__tests__/support/helpers";

// ---------------------------------------------------------------------------
// Mocks: the outbound swarm network boundary and Redis (in-memory fake).
// DB, encryption (real envelopes via the swarm factory) and the real parser
// all run for real.
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

const { readHostStorage } = await import("@/services/swarm/host-storage-read");

type Body = Record<string, unknown>;

function clone(obj: unknown): Body {
  return JSON.parse(JSON.stringify(obj)) as Body;
}

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
  swarmUrl?: string | null;
  /** null = store no password at all; omitted = a real encrypted envelope. */
  swarmPassword?: string | null;
  name?: string;
  workspaceId?: string;
}) {
  let workspaceId = options.workspaceId;
  if (!workspaceId) {
    const scenario = await createTestWorkspaceScenario({});
    workspaceId = scenario.workspace.id;
  }
  const swarmPassword = options.swarmPassword === null ? undefined : (options.swarmPassword ?? "test-swarm-password");
  return createTestSwarm({
    workspaceId,
    name: options.name ?? `host-storage-read-${generateUniqueId()}`,
    swarmUrl: options.swarmUrl ?? "https://host-storage-read.sphinx.chat",
    ...(swarmPassword !== undefined ? { swarmPassword } : {}),
    ec2Id: options.ec2Id,
  });
}

describe("readHostStorage - Integration Tests", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse(cleanContractBody()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a malformed instanceId is rejected before any DB query", async () => {
    // The DB-query-excluded guarantee is pinned with an explicit mock in the
    // unit suite; spying on a Prisma model delegate corrupts it for later
    // tests, so here we pin the typed rejection outcome only.
    const result = await readHostStorage("not-an-instance-id");

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("INVALID_INSTANCE_ID");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("zero matching swarm rows returns no_swarm_record", async () => {
    const result = await readHostStorage(freshEc2Id());

    expect(result.outcome).toBe("no_swarm_record");
    expect(result.reasonCode).toBe("NO_SWARM_RECORD");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("more than one matching swarm row returns ambiguous, not an arbitrary row", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id, name: `dup-a-${generateUniqueId()}` });
    await createSwarmForInstance({ ec2Id, name: `dup-b-${generateUniqueId()}` });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("ambiguous");
    expect(result.reasonCode).toBe("AMBIGUOUS");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a swarm with no stored password is skipped without decrypting or logging in", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id, swarmPassword: null });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a soft-deleted owning workspace is skipped without decrypting or transmitting credentials", async () => {
    const ec2Id = freshEc2Id();
    const { workspace } = await createTestWorkspaceScenario({});
    await createSwarmForInstance({ ec2Id, workspaceId: workspace.id });
    await db.workspace.update({ where: { id: workspace.id }, data: { deleted: true } });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("WORKSPACE_DELETED");
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a stored password that is not an encrypted envelope returns DECRYPT_FAILED and does not attempt a login", async () => {
    const ec2Id = freshEc2Id();
    const swarm = await createSwarmForInstance({ ec2Id });
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmPassword: "plaintext-not-an-envelope" },
    });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("DECRYPT_FAILED");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a resolved host failing the allowed-suffix check is rejected before authenticating", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id, swarmUrl: "https://evil.example.com" });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a successful read returns a fresh normalised reading from the DB swarmUrl and caches it", async () => {
    const ec2Id = freshEc2Id();
    const swarm = await createSwarmForInstance({ ec2Id });

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("fresh");
    expect(result.cached).toBe(false);
    expect(result.collectedAt).toBe(1730000000);
    expect(result.reading?.status).toBe("OK");
    expect(result.reading?.governingFilesystem?.mount).toBe("/");
    // The DB row's URL is the only URL ever used — there is no caller input.
    expect(mockGetJwt).toHaveBeenCalledWith(
      "https://host-storage-read.sphinx.chat",
      "test-swarm-password",
      "admin",
      expect.any(Number),
    );
    // Cached under the instanceId with the original collectedAt.
    const cachedRaw = redisStore.get(`admin:swarms:host-storage:${ec2Id}`);
    expect(cachedRaw).toBeTruthy();
    expect(JSON.parse(cachedRaw!).reading.collectedAt).toBe(1730000000);
    expect(swarm.id).toBeTruthy();
  });

  test("a second call inside the cooldown returns cached with the ORIGINAL collectedAt and no outbound call", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    const first = await readHostStorage(ec2Id);
    expect(first.outcome).toBe("fresh");
    const callsAfterFirst = mockCmdRequest.mock.calls.length;

    const second = await readHostStorage(ec2Id);

    expect(second.outcome).toBe("cached");
    expect(second.cached).toBe(true);
    expect(second.collectedAt).toBe(1730000000); // original, never restamped
    expect(second.reading?.collectedAt).toBe(1730000000);
    expect(mockCmdRequest.mock.calls.length).toBe(callsAfterFirst); // no outbound call
    expect(mockGetJwt.mock.calls.length).toBe(1); // no second login either
  });

  test("a timeout produces unreachable with reason TIMEOUT, not a thrown exception", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const result = await readHostStorage(ec2Id);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("TIMEOUT");
    expect(redisStore.size).toBe(0); // failures are not cached
  });

  test("no log line or returned value contains the raw body or raw JWT-login error text", async () => {
    const ec2Id = freshEc2Id();
    await createSwarmForInstance({ ec2Id });

    // Login failure carrying raw swarm text in the message (as getSwarmCmdJwt does).
    mockGetJwt.mockRejectedValue(new Error("Swarm login failed (401): RAW_LOGIN_ERROR_MARKER"));
    const authResult = await readHostStorage(ec2Id);
    expect(authResult.outcome).toBe("failed");
    expect(authResult.reasonCode).toBe("AUTH_FAILED");

    // Malformed body carrying a raw-body marker.
    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse({ source: 123, leaked: "RAW_BODY_MARKER" }));
    const malformedResult = await readHostStorage(ec2Id);
    expect(malformedResult.outcome).toBe("failed");
    expect(malformedResult.reasonCode).toBe("MALFORMED");

    const everything = JSON.stringify({ authResult, malformedResult }) + consoleErrorSpy.mock.calls.flat().map(String).join(" ");
    expect(everything).not.toContain("RAW_LOGIN_ERROR_MARKER");
    expect(everything).not.toContain("RAW_BODY_MARKER");
  });
});
