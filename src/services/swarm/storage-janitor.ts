import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listSuperadminInstances, type Ec2InstanceInfo } from "@/services/ec2";
import {
  readHostStorage,
  type HostStorageReadOutcome,
  type HostStorageReadResult,
} from "@/services/swarm/host-storage-read";
import type { HostStorageReading, HostStorageService } from "@/services/swarm/host-storage";

/**
 * Daily host-storage snapshot janitor.
 *
 * Enumerates running swarm EC2 instances, reads each via `readHostStorage`
 * (SSRF allowlist lives there — never construct outbound requests here),
 * upserts one row per instance per UTC calendar day, then prunes past the
 * retention window.
 *
 * `readHostStorage` is contractually non-throwing; mapping is by switching
 * on `result.outcome`. A thin per-instance try/catch is only a last-resort
 * guard so an unexpected throw cannot abort the run.
 *
 * Cached readings keep their original (older) `collectedAt` — the dashboard
 * "captured at" reflects when the data was actually collected, not when
 * this janitor ran.
 */

const LOG_PREFIX = "[HostStorage]";

/** Days of snapshots to keep. Also drives the admin history window. */
export const SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS = 90;

/** Parallel live reads. Each can take up to READ_TIMEOUT_MS (~18s). */
const READ_CONCURRENCY = 5;

const LIVE_INSTANCE_STATE = "running";

export interface SwarmStorageJanitorError {
  instanceId: string;
  outcome: string;
  reasonCode?: string;
}

export interface SwarmStorageJanitorSummary {
  recorded: number;
  failed: number;
  skipped: number;
  pruned: number;
  errors: SwarmStorageJanitorError[];
}

interface SnapshotValues {
  instanceId: string;
  swarmId: string | null;
  date: Date;
  status: string;
  reasonCode: string | null;
  totalBytes: bigint | null;
  usedBytes: bigint | null;
  freeBytes: bigint | null;
  mount: string | null;
  services: HostStorageService[];
  hostVisible: boolean | null;
  source: string | null;
  collectedAt: Date | null;
}

/** UTC-normalized calendar day of `now` (matches the 03:00 UTC cron). */
export function utcCalendarDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toBigInt(value: number | null | undefined): bigint | null {
  if (value == null || !Number.isFinite(value)) return null;
  return BigInt(Math.trunc(value));
}

function fromUnixSeconds(value: number | null | undefined): Date | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

function emptyMetrics(overrides: Partial<SnapshotValues> = {}): Omit<SnapshotValues, "instanceId" | "date"> {
  return {
    swarmId: null,
    status: "FAILED",
    reasonCode: null,
    totalBytes: null,
    usedBytes: null,
    freeBytes: null,
    mount: null,
    services: [],
    hostVisible: null,
    source: null,
    collectedAt: null,
    ...overrides,
  };
}

function metricsFromReading(
  reading: HostStorageReading,
  collectedAt: number | null | undefined,
): Pick<
  SnapshotValues,
  | "status"
  | "totalBytes"
  | "usedBytes"
  | "freeBytes"
  | "mount"
  | "services"
  | "hostVisible"
  | "source"
  | "collectedAt"
> {
  const fs = reading.governingFilesystem;
  return {
    status: reading.status,
    totalBytes: toBigInt(fs?.totalBytes),
    usedBytes: toBigInt(fs?.usedBytes),
    freeBytes: toBigInt(fs?.freeBytes),
    mount: fs?.mount ?? null,
    services: reading.services ?? [],
    hostVisible: reading.hostVisible,
    source: reading.source,
    // Cached outcomes carry the original older collectedAt — persist as-is.
    collectedAt: fromUnixSeconds(collectedAt ?? reading.collectedAt),
  };
}

function isSuccessOutcome(outcome: HostStorageReadOutcome): boolean {
  return outcome === "fresh" || outcome === "cached";
}

function mapResult(
  instanceId: string,
  date: Date,
  swarmId: string | null,
  result: HostStorageReadResult,
): SnapshotValues {
  const linkedSwarmId =
    result.outcome === "no_swarm_record" || result.outcome === "ambiguous" ? null : swarmId;

  switch (result.outcome) {
    case "fresh":
    case "cached": {
      if (!result.reading) {
        return {
          instanceId,
          date,
          ...emptyMetrics({
            swarmId: linkedSwarmId,
            status: "ERROR",
            reasonCode: result.reasonCode ?? null,
          }),
        };
      }
      return {
        instanceId,
        date,
        swarmId: linkedSwarmId,
        reasonCode: result.reasonCode ?? null,
        ...metricsFromReading(result.reading, result.collectedAt),
      };
    }
    case "unreachable":
      return {
        instanceId,
        date,
        ...emptyMetrics({
          swarmId: linkedSwarmId,
          status: "UNREACHABLE",
          reasonCode: result.reasonCode ?? "UNREACHABLE",
        }),
      };
    case "no_swarm_record":
      return {
        instanceId,
        date,
        ...emptyMetrics({
          swarmId: null,
          status: "NO_SWARM_RECORD",
          reasonCode: result.reasonCode ?? "NO_SWARM_RECORD",
        }),
      };
    case "ambiguous":
      return {
        instanceId,
        date,
        ...emptyMetrics({
          swarmId: null,
          status: "AMBIGUOUS",
          reasonCode: result.reasonCode ?? "AMBIGUOUS",
        }),
      };
    case "failed":
      return {
        instanceId,
        date,
        ...emptyMetrics({
          swarmId: linkedSwarmId,
          status: "FAILED",
          reasonCode: result.reasonCode ?? "MALFORMED",
        }),
      };
  }
}

async function upsertSnapshot(row: SnapshotValues): Promise<void> {
  const services = row.services as unknown as Prisma.InputJsonValue;
  await db.swarmStorageSnapshot.upsert({
    where: {
      instanceId_date: {
        instanceId: row.instanceId,
        date: row.date,
      },
    },
    create: { ...row, services },
    update: {
      swarmId: row.swarmId,
      status: row.status,
      reasonCode: row.reasonCode,
      totalBytes: row.totalBytes,
      usedBytes: row.usedBytes,
      freeBytes: row.freeBytes,
      mount: row.mount,
      services,
      hostVisible: row.hostVisible,
      source: row.source,
      collectedAt: row.collectedAt,
    },
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function resolveSwarmIds(instanceIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (instanceIds.length === 0) return map;

  const rows = (await db.swarm.findMany({
    where: { ec2Id: { in: instanceIds } },
    select: { id: true, ec2Id: true },
  })) as Array<{ id: string; ec2Id: string | null }>;

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.ec2Id) continue;
    counts.set(row.ec2Id, (counts.get(row.ec2Id) ?? 0) + 1);
  }
  for (const row of rows) {
    if (!row.ec2Id) continue;
    if (counts.get(row.ec2Id) === 1) {
      map.set(row.ec2Id, row.id);
    }
  }
  return map;
}

function logInstance(
  instanceId: string,
  outcome: string,
  reasonCode: string | undefined,
  status: string,
): void {
  console.log(
    `${LOG_PREFIX} janitor instance=${instanceId} outcome=${outcome} reason=${reasonCode ?? "-"} status=${status}`,
  );
}

async function snapshotInstance(
  instance: Ec2InstanceInfo,
  date: Date,
  swarmIds: Map<string, string>,
): Promise<{ recorded: boolean; error?: SwarmStorageJanitorError }> {
  const instanceId = instance.instanceId;
  const swarmId = swarmIds.get(instanceId) ?? null;

  try {
    const result = await readHostStorage(instanceId);
    const row = mapResult(instanceId, date, swarmId, result);
    logInstance(instanceId, result.outcome, result.reasonCode, row.status);
    await upsertSnapshot(row);

    if (isSuccessOutcome(result.outcome)) {
      return { recorded: true };
    }
    return {
      recorded: false,
      error: {
        instanceId,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
      },
    };
  } catch {
    const row: SnapshotValues = {
      instanceId,
      date,
      ...emptyMetrics({
        swarmId,
        status: "FAILED",
        reasonCode: "UNEXPECTED",
      }),
    };
    logInstance(instanceId, "failed", "UNEXPECTED", "FAILED");
    try {
      await upsertSnapshot(row);
    } catch {
      // Persist failed; still count the instance as failed and continue.
    }
    return {
      recorded: false,
      error: { instanceId, outcome: "failed", reasonCode: "UNEXPECTED" },
    };
  }
}

export async function runSwarmStorageJanitor(now: Date = new Date()): Promise<SwarmStorageJanitorSummary> {
  const date = utcCalendarDate(now);
  console.log(`${LOG_PREFIX} janitor start date=${date.toISOString().slice(0, 10)}`);

  const instances = await listSuperadminInstances();
  const live: Ec2InstanceInfo[] = [];
  let skipped = 0;
  for (const instance of instances) {
    if (instance.state === LIVE_INSTANCE_STATE) {
      live.push(instance);
    } else {
      skipped += 1;
    }
  }

  let swarmIds = new Map<string, string>();
  try {
    swarmIds = await resolveSwarmIds(live.map((i) => i.instanceId));
  } catch {
    console.warn(`${LOG_PREFIX} janitor swarm lookup failed; continuing with null swarmId`);
  }

  const outcomes = await mapWithConcurrency(live, READ_CONCURRENCY, (instance) =>
    snapshotInstance(instance, date, swarmIds),
  );

  let recorded = 0;
  let failed = 0;
  const errors: SwarmStorageJanitorError[] = [];
  for (const outcome of outcomes) {
    if (outcome.recorded) {
      recorded += 1;
    } else {
      failed += 1;
      if (outcome.error) errors.push(outcome.error);
    }
  }

  const cutoff = utcCalendarDate(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS);
  let pruned = 0;
  try {
    const prunedResult = await db.swarmStorageSnapshot.deleteMany({
      where: { date: { lt: cutoff } },
    });
    pruned = prunedResult?.count ?? 0;
  } catch {
    console.warn(`${LOG_PREFIX} janitor prune failed`);
  }

  console.log(
    `${LOG_PREFIX} janitor done recorded=${recorded} failed=${failed} skipped=${skipped} pruned=${pruned}`,
  );

  return { recorded, failed, skipped, pruned, errors };
}
