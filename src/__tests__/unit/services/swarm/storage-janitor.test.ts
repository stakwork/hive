import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import type { HostStorageReading } from "@/services/swarm/host-storage";
import type { HostStorageReadResult } from "@/services/swarm/host-storage-read";
import type { Ec2InstanceInfo } from "@/services/ec2";

const mockReadHostStorage = vi.hoisted(() => vi.fn());
const mockListSuperadminInstances = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());
const mockSwarmFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    swarmStorageSnapshot: {
      upsert: mockUpsert,
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

vi.mock("@/services/swarm/host-storage-read", () => ({
  readHostStorage: mockReadHostStorage,
}));

import {
  runSwarmStorageJanitor,
  utcCalendarDate,
  SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS,
} from "@/services/swarm/storage-janitor";
import { GET } from "@/app/api/cron/swarm-storage-janitor/route";

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

function reading(overrides: Partial<HostStorageReading> = {}): HostStorageReading {
  return {
    status: "OK",
    hostVisible: true,
    source: "node_exporter",
    collectedAt: 1_700_000_000,
    cached: false,
    filesystems: [],
    dockerRootDir: "/var/lib/docker",
    dockerRootFilesystem: "/",
    governingFilesystem: {
      mount: "/",
      device: "/dev/nvme0n1p1",
      fstype: "ext4",
      totalBytes: 500_000_000_000,
      usedBytes: 200_000_000_000,
      freeBytes: 300_000_000_000,
      describesHost: true,
    },
    volumes: [],
    neo4j: {
      volumes: ["neo4j-data"],
      sizeBytes: 12_000_000_000,
      sizeKnown: true,
    },
    services: [],
    errors: [],
    ...overrides,
  };
}

function freshResult(overrides: Partial<HostStorageReadResult> = {}): HostStorageReadResult {
  const r = reading();
  return {
    outcome: "fresh",
    reading: r,
    collectedAt: r.collectedAt,
    cached: false,
    ...overrides,
  };
}

const NOW = new Date("2026-04-10T15:22:00.000Z");
const UTC_DAY = utcCalendarDate(NOW);
const RUNNING_A = "i-0aaa1111bbb2222c";
const RUNNING_B = "i-0ccc3333ddd4444e";

function upsertArgs() {
  return mockUpsert.mock.calls.map((call) => call[0]);
}

function createdRows() {
  return upsertArgs().map((args) => args.create);
}

describe("runSwarmStorageJanitor", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockUpsert.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockSwarmFindMany.mockResolvedValue([
      { id: "swarm-a", ec2Id: RUNNING_A },
      { id: "swarm-b", ec2Id: RUNNING_B },
    ]);
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance(RUNNING_B, "running"),
    ]);
    mockReadHostStorage.mockResolvedValue(freshResult());
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("maps a fresh OK reading onto governing-filesystem and neo4j BigInt columns", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockReadHostStorage.mockResolvedValue(freshResult());

    const summary = await runSwarmStorageJanitor(NOW);

    expect(summary.recorded).toBe(1);
    expect(summary.failed).toBe(0);
    const row = createdRows()[0];
    expect(row.status).toBe("OK");
    expect(row.reasonCode).toBeNull();
    expect(row.swarmId).toBe("swarm-a");
    expect(row.instanceId).toBe(RUNNING_A);
    expect(row.date).toEqual(UTC_DAY);
    expect(row.totalBytes).toBe(500_000_000_000n);
    expect(row.usedBytes).toBe(200_000_000_000n);
    expect(row.freeBytes).toBe(300_000_000_000n);
    expect(row.mount).toBe("/");
    expect(row.neo4jSizeBytes).toBe(12_000_000_000n);
    expect(row.neo4jSizeKnown).toBe(true);
    expect(row.hostVisible).toBe(true);
    expect(row.source).toBe("node_exporter");
    expect(row.collectedAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(row).not.toHaveProperty("error");
    expect(row).not.toHaveProperty("filesystems");
  });

  it("preserves the original older collectedAt on a cached outcome", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    const older = 1_699_000_000;
    mockReadHostStorage.mockResolvedValue({
      outcome: "cached",
      reading: reading({ collectedAt: older }),
      collectedAt: older,
      cached: true,
    });

    await runSwarmStorageJanitor(NOW);

    const row = createdRows()[0];
    expect(row.status).toBe("OK");
    expect(row.collectedAt).toEqual(new Date(older * 1000));
    expect(row.collectedAt.getTime()).toBeLessThan(NOW.getTime());
  });

  it("writes null host metrics when governingFilesystem is null (PARTIAL)", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockReadHostStorage.mockResolvedValue(
      freshResult({
        reading: reading({
          status: "PARTIAL",
          governingFilesystem: null,
          neo4j: null,
        }),
      }),
    );

    const summary = await runSwarmStorageJanitor(NOW);

    expect(summary.recorded).toBe(1);
    const row = createdRows()[0];
    expect(row.status).toBe("PARTIAL");
    expect(row.totalBytes).toBeNull();
    expect(row.usedBytes).toBeNull();
    expect(row.freeBytes).toBeNull();
    expect(row.mount).toBeNull();
    expect(row.neo4jSizeBytes).toBeNull();
    expect(row.neo4jSizeKnown).toBe(false);
  });

  it("maps unreachable / no_swarm_record / ambiguous / failed without raw error text", async () => {
    const ids = {
      unreachable: "i-0aaaa00000000001",
      none: "i-0aaaa00000000002",
      ambiguous: "i-0aaaa00000000003",
      failed: "i-0aaaa00000000004",
    };
    mockListSuperadminInstances.mockResolvedValue([
      instance(ids.unreachable, "running"),
      instance(ids.none, "running"),
      instance(ids.ambiguous, "running"),
      instance(ids.failed, "running"),
    ]);
    mockSwarmFindMany.mockResolvedValue([{ id: "swarm-fail", ec2Id: ids.failed }]);
    mockReadHostStorage.mockImplementation(async (id: string) => {
      if (id === ids.unreachable) {
        return { outcome: "unreachable", reasonCode: "TIMEOUT", cached: false };
      }
      if (id === ids.none) {
        return { outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD", cached: false };
      }
      if (id === ids.ambiguous) {
        return { outcome: "ambiguous", reasonCode: "AMBIGUOUS", cached: false };
      }
      return { outcome: "failed", reasonCode: "AUTH_FAILED", cached: false };
    });

    const summary = await runSwarmStorageJanitor(NOW);

    expect(summary.recorded).toBe(0);
    expect(summary.failed).toBe(4);
    expect(summary.errors).toEqual([
      { instanceId: ids.unreachable, outcome: "unreachable", reasonCode: "TIMEOUT" },
      { instanceId: ids.none, outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD" },
      { instanceId: ids.ambiguous, outcome: "ambiguous", reasonCode: "AMBIGUOUS" },
      { instanceId: ids.failed, outcome: "failed", reasonCode: "AUTH_FAILED" },
    ]);

    const byId = Object.fromEntries(createdRows().map((row) => [row.instanceId, row]));
    expect(byId[ids.unreachable].status).toBe("UNREACHABLE");
    expect(byId[ids.unreachable].reasonCode).toBe("TIMEOUT");
    expect(byId[ids.none].status).toBe("NO_SWARM_RECORD");
    expect(byId[ids.none].swarmId).toBeNull();
    expect(byId[ids.ambiguous].status).toBe("AMBIGUOUS");
    expect(byId[ids.ambiguous].swarmId).toBeNull();
    expect(byId[ids.failed].status).toBe("FAILED");
    expect(byId[ids.failed].reasonCode).toBe("AUTH_FAILED");
    expect(byId[ids.failed].swarmId).toBe("swarm-fail");

    for (const row of createdRows()) {
      expect(row.totalBytes).toBeNull();
      expect(row).not.toHaveProperty("error");
      const logged = logSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).not.toMatch(/stack|password|exception/i);
    }
  });

  it("continues when one instance throws unexpectedly", async () => {
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance(RUNNING_B, "running"),
    ]);
    mockReadHostStorage.mockImplementation(async (id: string) => {
      if (id === RUNNING_A) throw new Error("socket exploded with secret xyz");
      return freshResult();
    });

    const summary = await runSwarmStorageJanitor(NOW);

    expect(summary.recorded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([
      { instanceId: RUNNING_A, outcome: "failed", reasonCode: "UNEXPECTED" },
    ]);
    expect(createdRows()).toHaveLength(2);
    const failedRow = createdRows().find((row) => row.instanceId === RUNNING_A);
    expect(failedRow?.status).toBe("FAILED");
    expect(failedRow?.reasonCode).toBe("UNEXPECTED");
    const logged = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(logged).not.toContain("socket exploded");
    expect(logged).not.toContain("secret xyz");
  });

  it("re-runs the same UTC day upsert in place (no duplicate rows)", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);

    await runSwarmStorageJanitor(NOW);
    await runSwarmStorageJanitor(new Date("2026-04-10T23:59:00.000Z"));

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const keys = upsertArgs().map((args) => args.where.instanceId_date);
    expect(keys[0]).toEqual({ instanceId: RUNNING_A, date: UTC_DAY });
    expect(keys[1]).toEqual({ instanceId: RUNNING_A, date: UTC_DAY });
    expect(keys[0].date).toEqual(keys[1].date);
  });

  it("buckets snapshots on the UTC calendar day, not local server time", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);

    await runSwarmStorageJanitor(new Date("2026-01-01T00:30:00.000Z"));
    await runSwarmStorageJanitor(new Date("2025-12-31T23:30:00.000Z"));

    const dates = createdRows().map((row) => row.date.toISOString());
    expect(dates[0]).toBe("2026-01-01T00:00:00.000Z");
    expect(dates[1]).toBe("2025-12-31T00:00:00.000Z");
  });

  it("prunes only rows older than the retention constant", async () => {
    mockListSuperadminInstances.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 4 });

    const summary = await runSwarmStorageJanitor(NOW);

    expect(summary.pruned).toBe(4);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    const cutoff: Date = mockDeleteMany.mock.calls[0][0].where.date.lt;
    const expected = utcCalendarDate(NOW);
    expected.setUTCDate(expected.getUTCDate() - SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS);
    expect(cutoff).toEqual(expected);
    expect(SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS).toBe(90);
  });

  it("skips stopped and terminated instances before any read", async () => {
    mockListSuperadminInstances.mockResolvedValue([
      instance(RUNNING_A, "running"),
      instance("i-0stopped00000001", "stopped"),
      instance("i-0terminated00001", "terminated"),
      instance("i-0pending00000001", "pending"),
    ]);

    const summary = await runSwarmStorageJanitor(NOW);

    expect(mockReadHostStorage).toHaveBeenCalledTimes(1);
    expect(mockReadHostStorage).toHaveBeenCalledWith(RUNNING_A);
    expect(summary.skipped).toBe(3);
    expect(summary.recorded).toBe(1);
    expect(createdRows().map((row) => row.instanceId)).toEqual([RUNNING_A]);
  });
});

describe("GET /api/cron/swarm-storage-janitor", () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  function makeRequest(authHeader?: string): NextRequest {
    return new NextRequest("http://localhost/api/cron/swarm-storage-janitor", {
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
  });

  it("returns 401 with no auth header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockListSuperadminInstances).not.toHaveBeenCalled();
  });

  it("returns 200 with the janitor summary on a valid bearer token", async () => {
    mockListSuperadminInstances.mockResolvedValue([instance(RUNNING_A, "running")]);
    mockSwarmFindMany.mockResolvedValue([{ id: "swarm-a", ec2Id: RUNNING_A }]);
    mockReadHostStorage.mockResolvedValue(freshResult());
    mockUpsert.mockResolvedValue({});
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

describe("vercel.json swarm-storage-janitor cron", () => {
  it("registers the daily 03:00 UTC schedule", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    const cron = vercelConfig.crons.find(
      (entry: { path: string; schedule: string }) =>
        entry.path === "/api/cron/swarm-storage-janitor",
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe("0 3 * * *");
  });
});
