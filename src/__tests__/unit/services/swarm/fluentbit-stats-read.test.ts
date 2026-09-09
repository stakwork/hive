import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/fluentbit-stats.contract.json";
import { NULL_FLUENTBIT_RATES } from "@/services/swarm/fluentbit-stats";

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

const { readFluentbitStats } = await import("@/services/swarm/fluentbit-stats-read");
const { SwarmAuthError } = await import("@/services/swarm/cmd");
const { GET_FLUENTBIT_STATS_CMD } = await import("@/services/swarm/fluentbit-stats");

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
    workspaceId: "workspace-1",
    workspace: { deleted: false },
    ...overrides,
  };
}

function okCmdResponse(data: unknown): SwarmCmdResponse {
  return { ok: true, status: 200, data, rawText: undefined };
}

function timeoutResponse(): SwarmCmdResponse {
  return { ok: false, status: 0, data: null, rawText: "", errorCode: "TIMEOUT" };
}

const INSTANCE_ID = "i-0abc123def456789";
const COOLDOWN_KEY = `admin:swarms:fluentbit-stats:${INSTANCE_ID}`;
const PREV_KEY = `admin:swarms:fluentbit-prev:${INSTANCE_ID}`;

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

function redisGets(): string[] {
  return mockRedisGet.mock.calls.map((c) => String(c[0]));
}

function redisSetexKeys(): string[] {
  return mockRedisSetex.mock.calls.map((c) => String(c[0]));
}

describe("readFluentbitStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue(undefined);
    mockDecryptField.mockReturnValue("decrypted-plain-pw");
    mockGetJwt.mockResolvedValue("cmd-jwt");
    mockCmdRequest.mockResolvedValue(okCmdResponse(clone(contractFixture)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects a malformed or empty instanceId before any DB query or cache lookup", async () => {
    for (const bad of ["", "not-an-instance", "i-", "i-GHIJKL", "i-XYZ !!!", "../etc/passwd"]) {
      const result = await readFluentbitStats(bad);

      expect(result.outcome).toBe("failed");
      expect(result.reasonCode).toBe("INVALID_INSTANCE_ID");
      expect(result.reading).toBeUndefined();
      expect(result.cached).toBe(false);
    }
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  test("a cooldown hit returns the cached reading with baked-in rates UNCHANGED and never reads the prev-sample key", async () => {
    const cachedReading = {
      status: "OK",
      available: true,
      collectedAt: 1757430000,
      inputBytes: 12345,
      inputRecords: 67,
      outputProcBytes: 12000,
      outputProcRecords: 65,
      filterDropRecords: 0,
      outputDroppedRecords: 0,
      outputErrors: 0,
      retriesFailed: 0,
      uptimeSeconds: 3600,
      errors: [],
      rates: {
        inputBytesPerSec: 12.5,
        inputRecordsPerSec: 0.4,
        outputProcBytesPerSec: 10,
        outputProcRecordsPerSec: 0.3,
      },
      rateWindowSeconds: 64,
    };
    mockRedisGet.mockImplementation(async (key: string) => {
      if (key === COOLDOWN_KEY) return JSON.stringify({ reading: cachedReading });
      return null;
    });

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result).toEqual({
      outcome: "cached",
      reading: cachedReading,
      collectedAt: 1757430000,
      cached: true,
    });
    expect(result.reading?.rates.inputBytesPerSec).toBe(12.5);
    expect(result.reading?.rateWindowSeconds).toBe(64);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
    expect(redisGets()).toEqual([COOLDOWN_KEY]);
    expect(redisGets()).not.toContain(PREV_KEY);
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  test("a corrupt cooldown entry is treated as a miss and the live read proceeds", async () => {
    mockRedisGet.mockResolvedValue("not-json{{");
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(mockGetJwt).toHaveBeenCalledTimes(1);
  });

  test("a successful fresh read writes cooldown (60s) then overwrites prev (600s) with the current snapshot", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.cached).toBe(false);
    expect(result.workspaceId).toBeUndefined();
    expect(result.collectedAt).toBe(1757430000);
    expect(result.reading?.rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(result.reading?.rateWindowSeconds).toBeNull();

    expect(mockRedisSetex).toHaveBeenCalledTimes(2);
    const [[cooldownKey, cooldownTtl, cooldownPayload], [prevKey, prevTtl, prevPayload]] =
      mockRedisSetex.mock.calls;
    expect(cooldownKey).toBe(COOLDOWN_KEY);
    expect(cooldownTtl).toBe(60);
    expect(JSON.parse(cooldownPayload).reading.collectedAt).toBe(1757430000);
    expect(JSON.parse(cooldownPayload).reading.rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(prevKey).toBe(PREV_KEY);
    expect(prevTtl).toBe(600);
    expect(JSON.parse(prevPayload)).toEqual({
      collectedAt: 1757430000,
      inputBytes: 12345,
      inputRecords: 67,
      outputProcBytes: 12000,
      outputProcRecords: 65,
    });
  });

  test("a live OK read computes rates against a valid prev sample", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockRedisGet.mockImplementation(async (key: string) => {
      if (key === PREV_KEY) {
        return JSON.stringify({
          collectedAt: 1757430000 - 10,
          inputBytes: 2345,
          inputRecords: 47,
          outputProcBytes: 2000,
          outputProcRecords: 45,
        });
      }
      return null;
    });

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.rateWindowSeconds).toBe(10);
    expect(result.reading?.rates.inputBytesPerSec).toBe(1000);
    expect(result.reading?.rates.inputRecordsPerSec).toBe(2);
    expect(result.reading?.rates.outputProcBytesPerSec).toBe(1000);
    expect(result.reading?.rates.outputProcRecordsPerSec).toBe(2);
  });

  test("prev-sample key is NOT overwritten when the live read is UNAVAILABLE", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    const unavailable = clone(contractFixture);
    unavailable.available = false;
    mockCmdRequest.mockResolvedValue(okCmdResponse(unavailable));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.status).toBe("UNAVAILABLE");
    expect(result.reading?.rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(result.reading?.rateWindowSeconds).toBeNull();
    expect(redisSetexKeys()).toEqual([COOLDOWN_KEY]);
    expect(redisSetexKeys()).not.toContain(PREV_KEY);
    expect(redisGets()).not.toContain(PREV_KEY);
  });

  test("prev-sample key IS overwritten after a live OK read even when a counter decreased", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockRedisGet.mockImplementation(async (key: string) => {
      if (key === PREV_KEY) {
        return JSON.stringify({
          collectedAt: 1757430000 - 60,
          inputBytes: 999999,
          inputRecords: 47,
          outputProcBytes: 2000,
          outputProcRecords: 45,
        });
      }
      return null;
    });

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.rates.inputBytesPerSec).toBeNull();
    expect(result.reading?.rates.inputRecordsPerSec).toBeCloseTo(20 / 60);
    expect(redisSetexKeys()).toContain(PREV_KEY);
    const prevCall = mockRedisSetex.mock.calls.find((c) => c[0] === PREV_KEY);
    expect(JSON.parse(prevCall![2])).toMatchObject({
      collectedAt: 1757430000,
      inputBytes: 12345,
    });
  });

  test("a failed read (unreachable) is NOT written to cooldown or prev", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  test("zero matching swarm rows returns no_swarm_record without any credential work", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("no_swarm_record");
    expect(result.reasonCode).toBe("NO_SWARM_RECORD");
    expect(result.workspaceId).toBeUndefined();
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("more than one matching swarm row returns ambiguous — never an arbitrary pick", async () => {
    mockFindMany.mockResolvedValue([swarmRow(), swarmRow({ id: "swarm-2" })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("ambiguous");
    expect(result.reasonCode).toBe("AMBIGUOUS");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("missing swarmUrl is skipped as CONFIG_INVALID without decrypting or logging in", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: null })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("missing swarmPassword is skipped as CONFIG_INVALID without decrypting or logging in", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: null })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a soft-deleted owning workspace is skipped without decrypting or transmitting credentials", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ workspace: { deleted: true } })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("WORKSPACE_DELETED");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a stored password that is not an encrypted envelope returns DECRYPT_FAILED and does NOT attempt a login", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: "plaintext-password" })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("DECRYPT_FAILED");
    expect(result.workspaceId).toBe("workspace-1");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a decrypt failure returns DECRYPT_FAILED instead of attempting a login", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockDecryptField.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("DECRYPT_FAILED");
    expect(result.workspaceId).toBe("workspace-1");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("the swarmUrl resolved from the DB row is used — no caller input exists to override it", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "https://swarm42.sphinx.chat" })]);

    await readFluentbitStats(INSTANCE_ID);

    expect(mockGetJwt).toHaveBeenCalledWith(
      "https://swarm42.sphinx.chat",
      "decrypted-plain-pw",
      "admin",
      18_000,
    );
    expect(mockCmdRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmUrl: "https://swarm42.sphinx.chat",
        cmd: GET_FLUENTBIT_STATS_CMD,
        timeoutMs: 18_000,
      }),
    );
  });

  test("a resolved host failing the allowed-suffix check is rejected before authenticating", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "https://evil.example.com" })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(mockGetJwt).not.toHaveBeenCalled();
    expect(mockCmdRequest).not.toHaveBeenCalled();
  });

  test("a non-http(s) or unparseable swarmUrl is rejected before authenticating", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: "not a url at all" })]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("CONFIG_INVALID");
    expect(mockGetJwt).not.toHaveBeenCalled();
  });

  test("a clean contract body yields a fresh reading with normalised fields", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.status).toBe("OK");
    expect(result.reading?.inputBytes).toBe(12345);
    expect(result.reading?.uptimeSeconds).toBe(3600);
  });

  test("a PARTIAL reading (populated errors[]) is a successful fresh outcome and overwrites prev", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    const partial = clone(contractFixture);
    partial.errors = ["collector timed out"];
    mockCmdRequest.mockResolvedValue(okCmdResponse(partial));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("fresh");
    expect(result.reading?.status).toBe("PARTIAL");
    expect(result.reading?.errors).toEqual(["collector timed out"]);
    expect(redisSetexKeys()).toContain(PREV_KEY);
    expect(redisSetexKeys()).toContain(COOLDOWN_KEY);
  });

  test("an 18s abort on login maps to unreachable/TIMEOUT", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    mockGetJwt.mockRejectedValue(abortError);

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("TIMEOUT");
  });

  test("a timeout cmd response resolves as unreachable with reason TIMEOUT", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(timeoutResponse());

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("TIMEOUT");
    expect(result.reading).toBeUndefined();
  });

  test("a non-2xx cmd response is unreachable with reason HTTP_<status>", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue({ ok: false, status: 502, data: undefined, rawText: "Bad Gateway" });

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("HTTP_502");
  });

  test("a transport throw (DNS / connection refused) is unreachable with reason UNREACHABLE", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockRejectedValue(new TypeError("fetch failed"));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("UNREACHABLE");
  });

  test("a 401 SwarmAuthError is AUTH_FAILED and attaches workspaceId", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockGetJwt.mockRejectedValue(new SwarmAuthError(401));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("AUTH_FAILED");
    expect(result.workspaceId).toBe("workspace-1");
    expect(JSON.stringify(result)).not.toContain("RAW_JWT_ERROR_MARKER");
    expect(consoleOutput()).not.toContain("RAW_JWT_ERROR_MARKER");
  });

  test("a generic login Error is UNREACHABLE without surfacing the raw error text", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockGetJwt.mockRejectedValue(new Error("Swarm login failed (401): RAW_JWT_ERROR_MARKER"));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("UNREACHABLE");
    expect(result.workspaceId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("RAW_JWT_ERROR_MARKER");
    expect(consoleOutput()).not.toContain("RAW_JWT_ERROR_MARKER");
  });

  test("a non-401 SwarmAuthError is unreachable with HTTP_<status> and no workspaceId", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockGetJwt.mockRejectedValue(new SwarmAuthError(500));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("unreachable");
    expect(result.reasonCode).toBe("HTTP_500");
    expect(result.workspaceId).toBeUndefined();
  });

  test("AUTH_FAILED omits workspaceId when the swarm row has a falsy workspaceId", async () => {
    for (const workspaceId of [null, ""]) {
      mockFindMany.mockResolvedValue([swarmRow({ workspaceId })]);
      mockGetJwt.mockRejectedValue(new SwarmAuthError(401));

      const result = await readFluentbitStats(INSTANCE_ID);

      expect(result.outcome).toBe("failed");
      expect(result.reasonCode).toBe("AUTH_FAILED");
      expect(result.workspaceId).toBeUndefined();
      expect("workspaceId" in result).toBe(false);
    }
  });

  test("a malformed body is failed as MALFORMED with no raw body echoed through", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(okCmdResponse({ source: 123, leaked: "RAW_BODY_MARKER" }));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("MALFORMED");
    expect(JSON.stringify(result)).not.toContain("RAW_BODY_MARKER");
    expect(consoleOutput()).not.toContain("RAW_BODY_MARKER");
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  test("a stack_error body is failed as STACK_ERROR", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockCmdRequest.mockResolvedValue(okCmdResponse({ stack_error: "fluentbit exploded" }));

    const result = await readFluentbitStats(INSTANCE_ID);

    expect(result.outcome).toBe("failed");
    expect(result.reasonCode).toBe("STACK_ERROR");
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  test("logs the read attempt with swarmId and failures with swarmId + reason code", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ id: "swarm-log-check" })]);

    await readFluentbitStats(INSTANCE_ID);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[FluentbitStats] read attempt instance=${INSTANCE_ID} swarmId=swarm-log-check`),
    );

    mockCmdRequest.mockResolvedValue(timeoutResponse());
    consoleErrorSpy.mockClear();
    await readFluentbitStats(INSTANCE_ID);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("swarmId=swarm-log-check"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("reason=TIMEOUT"),
    );
  });
});
