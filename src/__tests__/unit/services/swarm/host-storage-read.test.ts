import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/host-storage.contract.json";

// ---------------------------------------------------------------------------
// Mocks — network (cmd), DB, Redis; encryption is part-real (envelope shape)
// ---------------------------------------------------------------------------

const mockFindMany = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSetex = vi.hoisted(() => vi.fn());
const mockDecryptField = vi.hoisted(() => vi.fn());
const mockGetJwt = vi.hoisted(() => vi.fn());
const mockCmdRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { swarm: { findMany: mockFindMany } },
}));

vi.mock("@/lib/redis", () => ({
  redis: { get: mockRedisGet, setex: mockRedisSetex },
}));

// Keep the real `isEncrypted` so envelope-shape gating is exercised genuinely;
// only the decrypt step is mocked.
vi.mock("@/lib/encryption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encryption")>();
  return {
    ...actual,
    EncryptionService: { getInstance: () => ({ decryptField: mockDecryptField }) },
  };
});

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

const { readHostStorage } = await import("@/services/swarm/host-storage-read");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

function clone(obj: unknown): Body {
  return JSON.parse(JSON.stringify(obj)) as Body;
}

function envelopeJson(): string {
  return JSON.stringify({
    data: "ZW5jcnlwdGVkLXB3",
    iv: "MDEyMzQ1Njc4OWFiY2RlZg==",
    tag: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    keyId: "default",
    version: "1",
    encryptedAt: new Date().toISOString(),
  });
}

function swarmRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "swarm-1",
    swarmUrl: "https://swarm40.sphinx.chat",
    swarmPassword: envelopeJson(),
    workspace: { deleted: false },
    ...overrides,
  };
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

const INSTANCE_ID = "i-0abc123def456789";
const COOLDOWN_KEY = `admin:swarms:host-storage:${INSTANCE_ID}`;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

function consoleOutput(): string {
  return [
    ...(consoleErrorSpy.mock.calls as unknown[][]),
    ...(consoleLogSpy.mock.calls as unknown[][]),
    ...(consoleWarnSpy.mock.calls as unknown[][]),
  ]
    .map((args) => args.map(String).join(" "))
    .join("\n");
}

describe("readHostStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue(undefined);
    mockDecryptField.mockReturnValue("decrypted-plain-pw");
    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse(cleanContractBody()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Input validation — before any DB query
  // ------------------------------------------------------------------

  test("rejects a malformed or empty instanceId before any DB query or cache lookup", async () => {
    for (const bad of ["", "not-an-instance", "i-", "i-GHIJKL", "i-XYZ !!!", "../etc/passwd"]) {
      const result = await readHostStorage(bad);

      expect(result.outcome).toBe("failed");
      expect(result.reasonCode).toBe("INVALID_INSTANCE_ID");
      expect(result.reading).toBeUndefined();
      expect(result.cached).toBe(false);
    }
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Cooldown cache
  // ------------------------------------------------------------------

  test("a hit inside the cooldown returns the cached reading with its ORIGINAL collectedAt and makes no outbound call", async () => {
    const cachedReading = {
      status: "OK",
      hostVisible: true,
      source: "node_exporter",
      collectedAt: 1730000000,
      cached: false,
      filesystems: [],
      dockerRootDir: "/var/lib/docker",
      dockerRootFilesystem: "/",
      governingFilesystem: null,
      volumes: [],
      neo4j: null,
      errors: [],
    };
    mockRedisGet.mockResolvedValue(JSON.stringify({ reading: cachedReading }));

    const result = await readHostStorage(INSTANCE_ID);

    expect(result).toEqual({
      outcome: "cached",
      reading: cachedReading,
      collectedAt: 1730000000,
      cached: true,
    });
    // No swarm contact, no credential work, not even a DB query.
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a corrupt cooldown entry is treated as a miss and the live read proceeds", async () => {
    mockRedisGet.mockResolvedValue("not-json{{");
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(mockGetJwt).toHaveBeenCalledTimes(1);
  });

  test("a successful fresh read is written to the cooldown with a 60s TTL and the original collectedAt", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.cached).toBe(false);
    expect(result.collectedAt).toBe(1730000000); // swarm-side collected_at, not restamped
    expect(mockRedisSetex).toHaveBeenCalledTimes(1);
    const [key, ttl, payload] = mockRedisSetex.mock.calls[0];
    expect(key).toBe(COOLDOWN_KEY);
    expect(ttl).toBe(60);
    expect(JSON.parse(payload).reading.collectedAt).toBe(1730000000);
  });

  test("a failed read (unreachable) is NOT written to the cooldown", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Swarm resolution — exactly one match
  // ------------------------------------------------------------------

  test("zero matching swarm rows returns no_swarm_record without any credential work", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("no_swarm_record");
    expect(result.reasonCode).toBe("NO_SWARM_RECORD");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("more than one matching swarm row returns ambiguous — never an arbitrary pick", async () => {
    mockFindMany.mockResolvedValue([swarmRow(), swarmRow({ id: "swarm-2" })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("ambiguous");
    expect(result.reasonCode).toBe("AMBIGUOUS");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Skip conditions — no decrypt, no transmission
  // ------------------------------------------------------------------

  test("missing swarmUrl is skipped as CONFIG_INVALID without decrypting or logging in", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: null })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("missing swarmPassword is skipped as CONFIG_INVALID without decrypting or logging in", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: null })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a soft-deleted owning workspace is skipped without decrypting or transmitting credentials", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ workspace: { deleted: true } })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("WORKSPACE_DELETED");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Credentials — DB path, envelope gate
  // ------------------------------------------------------------------

  test("a stored password that is not an encrypted envelope returns DECRYPT_FAILED and does NOT attempt a login", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: "plaintext-password" })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("DECRYPT_FAILED");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a decrypt failure returns DECRYPT_FAILED instead of attempting a login", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockDecryptField.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("DECRYPT_FAILED");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Host allowlist — swarmUrl comes from the DB row only
  // ------------------------------------------------------------------

  test("the swarmUrl resolved from the DB row is used — no caller input exists to override it", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "https://swarm42.sphinx.chat" })]);

    await readHostStorage(INSTANCE_ID);

    expect(mockGetJwt).toHaveBeenCalledWith(
      "https://swarm42.sphinx.chat",
      "decrypted-plain-pw",
      "admin",
      expect.any(Number),
    );
    expect(mockCmdRequest).toHaveBeenCalledWith(
      expect.objectContaining({ swarmUrl: "https://swarm42.sphinx.chat" }),
    );
  });

  test("a resolved host failing the allowed-suffix check is rejected before authenticating", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "https://evil.example.com" })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled(); // login would transmit the password
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a non-http(s) or unparseable swarmUrl is rejected before authenticating", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "not a url at all" })]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Read + classification
  // ------------------------------------------------------------------

  test("a clean contract body yields a fresh reading with normalised fields", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.status).toBe("OK");
    expect(result.reading?.source).toBe("node_exporter");
    expect(result.reading?.governingFilesystem?.mount).toBe("/");
    expect(result.reading?.neo4j).toEqual({
      volumes: ["neo4j.sphinx"],
      sizeBytes: 0,
      sizeKnown: true,
    });
  });

  test("a PARTIAL reading (populated errors[]) is a successful fresh outcome", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(okCmdResponse(clone(contractFixture))); // fixture carries errors[]

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.status).toBe("PARTIAL");
    expect(result.reading?.errors).toEqual([
      { collector: "volumes", reason: "docker df timed out after 8s" },
    ]);
  });

  test("a timeout resolves (never throws) as unreachable with reason TIMEOUT", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("TIMEOUT");
    expect(result.reading).toBeUndefined();
  });

  test("a login timeout resolves as unreachable with reason TIMEOUT", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    mockGetJwt.mockRejectedValue(abortError);

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("TIMEOUT");
  });

  test("a non-2xx cmd response is unreachable with reason HTTP_<status>", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue({ ok: false, status: 502, data: undefined, rawText: "Bad Gateway" });

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("HTTP_502");
  });

  test("a transport throw (DNS / connection refused) is unreachable with reason UNREACHABLE", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockRejectedValue(new TypeError("fetch failed"));

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("UNREACHABLE");
  });

  test("a failed login is AUTH_FAILED without surfacing the raw error text", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockGetJwt.mockRejectedValue(new Error("Swarm login failed (401): RAW_JWT_ERROR_MARKER"));

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("AUTH_FAILED");
    expect(JSON.stringify(result)).not.toContain("RAW_JWT_ERROR_MARKER");
    expect(consoleOutput()).not.toContain("RAW_JWT_ERROR_MARKER");
  });

  test("a malformed body is failed as MALFORMED with no raw body echoed through", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(okCmdResponse({ source: 123, leaked: "RAW_BODY_MARKER" }));

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("MALFORMED");
    expect(JSON.stringify(result)).not.toContain("RAW_BODY_MARKER");
    expect(consoleOutput()).not.toContain("RAW_BODY_MARKER");
  });

  test("a stack_error body is failed as STACK_ERROR", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(okCmdResponse({ stack_error: "neo4j exploded" }));

    const result = await readHostStorage(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("STACK_ERROR");
  });

  // ------------------------------------------------------------------
  // Logging boundaries
  // ------------------------------------------------------------------

  test("logs the read attempt with swarmId and failures with swarmId + reason code", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ id: "swarm-log-check" })]);

    await readHostStorage(INSTANCE_ID);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[HostStorage] read attempt instance=${INSTANCE_ID} swarmId=swarm-log-check`),
    );

    mockCmdRequest.mockResolvedValue(timeoutResponse());
    consoleErrorSpy.mockClear();
    await readHostStorage(INSTANCE_ID);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("swarmId=swarm-log-check"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("reason=TIMEOUT"),
    );
  });
});
