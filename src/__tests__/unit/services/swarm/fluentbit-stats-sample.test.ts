import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import type { FluentbitStatsReading } from "@/services/swarm/fluentbit-stats";
import type { FluentbitStatsReadResult } from "@/services/swarm/fluentbit-stats-read";
import type { Ec2InstanceInfo } from "@/services/ec2";

const mockReadFluentbitStats = vi.hoisted(() => vi.fn());
const mockListSuperadminInstances = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());
const mockSwarmFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    fluentbitStatsSample: {
      create: mockCreate,
      deleteMany: mockDeleteMany,
    },
    swarm: {
      findMany: mockSwarmFindMany,
    },
  },
}));

vi.mock("@/services/ec2", () => ({
  listSuperadminInstances: mockListSuperadminInstances,
}));

vi.mock("@/services/swarm/fluentbit-stats-read", () => ({
  readFluentbitStats: mockReadFluentbitStats,
}));

import {
  runFluentbitStatsSampler,
  collectedAtFromUnixSeconds,
  FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS,
} from "@/services/swarm/fluentbit-stats-sample";
import { GET } from "@/app/api/cron/fluentbit-stats-sample/route";

function instance(
  instanceId: string,
  state: string,
  overrides: Partial<Ec2InstanceInfo> = {},
): Ec2InstanceInfo {
  return {
    instanceId,
    name: instanceId,
    state,
    instanceType: "t3.medium",
    launchTime: null,
    tags: [],
    publicIp: null,
    privateIp: null,
    hiveWorkspace: null,
    ...overrides,
  };
}

function reading(overrides: Partial<FluentbitStatsReading> = {}): FluentbitStatsReading {
  return {
    status: "OK",
    available: true,
    collectedAt: 1_757_430_000,
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
    containers: [
      { containerName: "hive-web", inputBytes: 8000, inputRecords: 40 },
      { containerName: "hive-worker", inputBytes: 3000, inputRecords: 20 },
    ],
    rates: {
      inputBytesPerSec: null,
      inputRecordsPerSec: null,
      outputProcBytesPerSec: null,
      outputProcRecordsPerSec: null,
    },
    rateWindowSeconds: null,
    ...overrides,
  };
}

function freshResult(overrides: Partial<FluentbitStatsReadResult> = {}): FluentbitStatsReadResult {
  const r = overrides.reading ?? reading();
  return {
    outcome: "fresh",
    reading: r,
    collectedAt: r.collectedAt,
    cached: false,
    ...overrides,
  };
}

const NOW = new Date("2026-04-10T15:22:00.000Z");
const RUNNING_A = "i-0aaa1111bbb2222c";
const RUNNING_B = "i-0ccc3333ddd4444e";

function createdRows() {
  return mockCreate.mock.calls.map((call) => call[0].data);
}

describe("collectedAtFromUnixSeconds", () => {
  it("converts a sane unix-seconds integer via * 1000, never passing raw seconds to Date", () => {
    const fallback = new Date("2026-04-10T15:22:00.000Z");
    expect(collectedAtFromUnixSeconds(1_757_430_000, fallback)).toEqual(
      new Date(1_757_430_000 * 1000),
    );
  });

  it("falls back when the value is missing, non-integer, or out of range", () => {
    const fallback = new Date("2026-04-10T15:22:00.000Z");
    expect(collectedAtFromUnixSeconds(undefined, fallback)).toEqual(fallback);
    expect(collectedAtFromUnixSeconds(null, fallback)).toEqual(fallback);
    expect(collectedAtFromUnixSeconds(1_757_430_000.5, fallback)).toEqual(fallback);
    expect(collectedAtFromUnixSeconds(0, fallback)).toEqual(fallback);
    expect(collectedAtFromUnixSeconds(100, fallback)).toEqual(fallback);
    expect(collectedAtFromUnixSeconds(9_999_999_999, fallback)).toEqual(fallback);
  });
});

describe("runFluentbitStatsSampler", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreate.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockSwarmFindMany.mockResolvedValue([
      { id: "swarm-a", ec2Id: RUNNING_A },
      { id: "swarm-b", ec2Id: RUNNING_B },
    ]);
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance(RUNNING_B, "running"),
    ]);
    mockReadFluentbitStats.mockResolvedValue(freshResult());
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("persists an OK reading with both counters as BigInt and normalized containers", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.recorded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(mockReadFluentbitStats).toHaveBeenCalledWith(RUNNING_A, {
      bypassCooldown: true,
      skipWriteCache: true,
    });
    const row = createdRows()[0];
    expect(row.status).toBe("OK");
    expect(row.swarmId).toBe("swarm-a");
    expect(row.instanceId).toBe(RUNNING_A);
    expect(row.inputBytes).toBe(12345n);
    expect(row.inputRecords).toBe(67n);
    expect(row.containers).toEqual([
      { containerName: "hive-web", inputBytes: 8000, inputRecords: 40 },
      { containerName: "hive-worker", inputBytes: 3000, inputRecords: 20 },
    ]);
    expect(row.collectedAt).toEqual(new Date(1_757_430_000 * 1000));
  });

  it("persists a PARTIAL reading with a null counter left null", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockReadFluentbitStats.mockResolvedValue(
      freshResult({
        reading: reading({
          status: "PARTIAL",
          inputBytes: 999,
          inputRecords: null,
          errors: ["collector timed out"],
          containers: null,
        }),
      }),
    );

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.recorded).toBe(1);
    const row = createdRows()[0];
    expect(row.status).toBe("PARTIAL");
    expect(row.inputBytes).toBe(999n);
    expect(row.inputRecords).toBeNull();
    expect(row.containers).toBe(Prisma.JsonNull);
  });

  it("skips UNAVAILABLE, unreachable, failed, ambiguous, and no_swarm_record without inserting", async () => {
    const ids = {
      unavailable: "i-0aaaa00000000001",
      unreachable: "i-0aaaa00000000002",
      failed: "i-0aaaa00000000003",
      ambiguous: "i-0aaaa00000000004",
      none: "i-0aaaa00000000005",
    };
    mockListSuperadminInstances.mockResolvedValue([
      instance(ids.unavailable, "running"),
      instance(ids.unreachable, "running"),
      instance(ids.failed, "running"),
      instance(ids.ambiguous, "running"),
      instance(ids.none, "running"),
    ]);
    mockReadFluentbitStats.mockImplementation(async (id: string) => {
      if (id === ids.unavailable) {
        return freshResult({
          reading: reading({ status: "UNAVAILABLE", available: false, inputBytes: null, inputRecords: null }),
        });
      }
      if (id === ids.unreachable) {
        return { outcome: "unreachable", reasonCode: "TIMEOUT", cached: false };
      }
      if (id === ids.failed) {
        return { outcome: "failed", reasonCode: "AUTH_FAILED", cached: false };
      }
      if (id === ids.ambiguous) {
        return { outcome: "ambiguous", reasonCode: "AMBIGUOUS", cached: false };
      }
      return { outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD", cached: false };
    });

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.recorded).toBe(0);
    expect(summary.failed).toBe(5);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(summary.errors.map((e) => e.outcome)).toEqual([
      "UNAVAILABLE",
      "unreachable",
      "failed",
      "ambiguous",
      "no_swarm_record",
    ]);

    const warned = warnSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(warned).toContain(`instance=${ids.unavailable} outcome=UNAVAILABLE`);
    expect(warned).toContain(`instance=${ids.unreachable} outcome=unreachable reason=TIMEOUT`);
    expect(warned).toContain(`instance=${ids.failed} outcome=failed reason=AUTH_FAILED`);
    expect(warned).toContain(`instance=${ids.ambiguous} outcome=ambiguous`);
    expect(warned).toContain(`instance=${ids.none} outcome=no_swarm_record`);
    expect(warned).not.toMatch(/password|jwt|Bearer /i);
  });

  it("skips a fresh OK/PARTIAL reading when both volume counters are null", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockReadFluentbitStats.mockResolvedValue(
      freshResult({
        reading: reading({ inputBytes: null, inputRecords: null }),
      }),
    );

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.recorded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("continues when one instance throws unexpectedly and never logs the throw text", async () => {
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance(RUNNING_B, "running"),
    ]);
    mockReadFluentbitStats.mockImplementation(async (id: string) => {
      if (id === RUNNING_A) throw new Error("socket exploded with secret xyz");
      return freshResult();
    });

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.recorded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([
      { instanceId: RUNNING_A, outcome: "failed", reasonCode: "UNEXPECTED" },
    ]);
    expect(createdRows()).toHaveLength(1);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(logged).not.toContain("socket exploded");
    expect(logged).not.toContain("secret xyz");
  });

  it("prunes only rows older than the 14-day retention window", async () => {
    mockListSuperadminInstances.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 4 });

    const summary = await runFluentbitStatsSampler(NOW);

    expect(summary.pruned).toBe(4);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    const cutoff: Date = mockDeleteMany.mock.calls[0][0].where.collectedAt.lt;
    const expected = new Date(NOW);
    expected.setUTCDate(expected.getUTCDate() - FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS);
    expect(cutoff).toEqual(expected);
    expect(FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS).toBe(14);
  });

  it("skips stopped and terminated instances before any read", async () => {
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance("i-0stopped00000001", "stopped"),
      instance("i-0terminated00001", "terminated"),
      instance("i-0pending00000001", "pending"),
    ]);

    const summary = await runFluentbitStatsSampler(NOW);

    expect(mockReadFluentbitStats).toHaveBeenCalledTimes(1);
    expect(mockReadFluentbitStats).toHaveBeenCalledWith(RUNNING_A, {
      bypassCooldown: true,
      skipWriteCache: true,
    });
    expect(summary.skipped).toBe(3);
    expect(summary.recorded).toBe(1);
    expect(createdRows().map((row) => row.instanceId)).toEqual([RUNNING_A]);
  });

  it("falls back to sampler now when collected_at is unsane", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockReadFluentbitStats.mockResolvedValue(
      freshResult({
        reading: reading({ collectedAt: 100 }),
        collectedAt: 100,
      }),
    );

    await runFluentbitStatsSampler(NOW);

    expect(createdRows()[0].collectedAt).toEqual(NOW);
  });

  it("logs start and end with recorded/failed/skipped/pruned counts", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockDeleteMany.mockResolvedValue({ count: 2 });

    await runFluentbitStatsSampler(NOW);

    const logged = logSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("[FluentbitStats] sampler start");
    expect(logged).toContain(
      "[FluentbitStats] sampler done recorded=1 failed=0 skipped=0 pruned=2",
    );
  });
});

describe("GET /api/cron/fluentbit-stats-sample", () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  function makeRequest(authHeader?: string): NextRequest {
    return new NextRequest("http://localhost/api/cron/fluentbit-stats-sample", {
      headers: authHeader ? { authorization: authHeader } : {},
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.CRON_SECRET = "test-cron-secret";
    mockListSuperadminInstances.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockSwarmFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
    vi.restoreAllMocks();
  });

  it("returns 401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(401);
    expect(mockListSuperadminInstances).not.toHaveBeenCalled();
    expect(mockReadFluentbitStats).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is empty", async () => {
    process.env.CRON_SECRET = "";
    const res = await GET(makeRequest("Bearer "));
    expect(res.status).toBe(401);
    expect(mockListSuperadminInstances).not.toHaveBeenCalled();
  });

  it("returns 401 with the wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockListSuperadminInstances).not.toHaveBeenCalled();
    expect(mockReadFluentbitStats).not.toHaveBeenCalled();
  });

  it("returns 401 with no auth header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockListSuperadminInstances).not.toHaveBeenCalled();
  });

  it("returns 200 with the sampler summary on a valid bearer token", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockSwarmFindMany.mockResolvedValue([{ id: "swarm-a", ec2Id: RUNNING_A }]);
    mockReadFluentbitStats.mockResolvedValue(freshResult());
    mockCreate.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({ count: 2 });

    const res = await GET(makeRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      recorded: 1,
      failed: 0,
      skipped: 0,
      pruned: 2,
      errors: [],
    });
  });
});

describe("vercel.json fluentbit-stats-sample cron", () => {
  it("registers the hourly :45 schedule", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    const cron = vercelConfig.crons.find(
      (entry: { path: string; schedule: string }) =>
        entry.path === "/api/cron/fluentbit-stats-sample",
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe("45 * * * *");
  });
});

describe("seedFluentbitStatsSamples", () => {
  it("is invoked from main immediately after seedSwarmStorageSnapshots", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts/helpers/seed-database.ts"),
      "utf8",
    );
    const mainIdx = src.indexOf("async function main()");
    expect(mainIdx).toBeGreaterThan(-1);
    const storage = src.indexOf("await seedSwarmStorageSnapshots()", mainIdx);
    const fluent = src.indexOf("await seedFluentbitStatsSamples()", mainIdx);
    expect(storage).toBeGreaterThan(-1);
    expect(fluent).toBeGreaterThan(storage);
  });
});
