import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listSuperadminInstances, type Ec2InstanceInfo } from "@/services/ec2";
import {
  readFluentbitStats,
  type FluentbitStatsReadOutcome,
  type FluentbitStatsReadResult,
} from "@/services/swarm/fluentbit-stats-read";
import type { FluentbitStatsContainer, FluentbitStatsReading } from "@/services/swarm/fluentbit-stats";

/**
 * Hourly FluentBit-stats sampler.
 *
 * Enumerates running swarm EC2 instances, reads each via `readFluentbitStats`
 * with cooldown bypass (SSRF allowlist lives there — never construct outbound
 * requests here), inserts a row for every successful OK/PARTIAL reading that
 * carries at least one volume counter, then prunes past the retention window.
 *
 * `readFluentbitStats` is contractually non-throwing; mapping is by switching
 * on `result.outcome`. A thin per-instance try/catch is only a last-resort
 * guard so an unexpected throw cannot abort the run.
 *
 * Failed / unreachable / UNAVAILABLE outcomes are logged and skipped — a
 * collector blip never punches a fabricated zero into history.
 */

const LOG_PREFIX = "[FluentbitStats]";

/** Days of samples to keep. Also drives the admin history window. */
export const FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS = 14;

/** Parallel live reads. Each can take up to READ_TIMEOUT_MS (~18s). */
const READ_CONCURRENCY = 5;

const LIVE_INSTANCE_STATE = "running";

/** Unix-seconds collected_at below this is treated as unsane (would land in 1970). */
const MIN_UNIX_SECONDS = 1_000_000_000;
/** Unix-seconds collected_at above this is treated as unsane (~year 2100). */
const MAX_UNIX_SECONDS = 4_102_444_800;

export interface FluentbitStatsSamplerError {
  instanceId: string;
  outcome: string;
  reasonCode?: string;
}

export interface FluentbitStatsSamplerSummary {
  recorded: number;
  failed: number;
  skipped: number;
  pruned: number;
  errors: FluentbitStatsSamplerError[];
}

interface SampleRow {
  instanceId: string;
  swarmId: string | null;
  collectedAt: Date;
  inputBytes: bigint | null;
  inputRecords: bigint | null;
  containers: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  status: string;
}

function toBigInt(value: number | null | undefined): bigint | null {
  if (value == null || !Number.isFinite(value)) return null;
  return BigInt(Math.trunc(value));
}

/**
 * Convert swarm `collected_at` unix seconds to a JS Date.
 * Never pass raw unix seconds into `new Date()` — that buckets the row in 1970.
 * Non-finite / non-integer / out-of-range values fall back to `fallback`.
 */
export function collectedAtFromUnixSeconds(
  value: number | null | undefined,
  fallback: Date,
): Date {
  if (
    value == null ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_UNIX_SECONDS ||
    value > MAX_UNIX_SECONDS
  ) {
    return fallback;
  }
  return new Date(value * 1000);
}

function containersJson(
  containers: FluentbitStatsContainer[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!containers || containers.length === 0) return Prisma.JsonNull;
  return containers as unknown as Prisma.InputJsonValue;
}

function isPersistableReading(
  reading: FluentbitStatsReading | undefined,
): reading is FluentbitStatsReading {
  if (!reading) return false;
  if (reading.status !== "OK" && reading.status !== "PARTIAL") return false;
  return reading.inputBytes != null || reading.inputRecords != null;
}

function isCacheableOutcome(outcome: FluentbitStatsReadOutcome): boolean {
  return outcome === "fresh" || outcome === "cached";
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

function logSkip(instanceId: string, outcome: string, reasonCode: string | undefined): void {
  console.warn(
    `${LOG_PREFIX} instance=${instanceId} outcome=${outcome} reason=${reasonCode ?? "-"}`,
  );
}

async function insertSample(row: SampleRow): Promise<void> {
  await db.fluentbitStatsSample.create({
    data: {
      instanceId: row.instanceId,
      swarmId: row.swarmId,
      collectedAt: row.collectedAt,
      inputBytes: row.inputBytes,
      inputRecords: row.inputRecords,
      containers: row.containers,
      status: row.status,
    },
  });
}

type SampleOutcome =
  | { kind: "recorded" }
  | { kind: "failed"; error: FluentbitStatsSamplerError };

async function sampleInstance(
  instance: Ec2InstanceInfo,
  swarmIds: Map<string, string>,
  now: Date,
): Promise<SampleOutcome> {
  const instanceId = instance.instanceId;
  const swarmId = swarmIds.get(instanceId) ?? null;

  try {
    const result: FluentbitStatsReadResult = await readFluentbitStats(instanceId, {
      bypassCooldown: true,
      skipWriteCache: true,
    });

    if (!isCacheableOutcome(result.outcome) || !isPersistableReading(result.reading)) {
      const outcomeLabel = result.reading?.status === "UNAVAILABLE" ? "UNAVAILABLE" : result.outcome;
      logSkip(instanceId, outcomeLabel, result.reasonCode ?? result.reading?.status);
      return {
        kind: "failed",
        error: {
          instanceId,
          outcome: outcomeLabel,
          reasonCode: result.reasonCode ?? result.reading?.status,
        },
      };
    }

    const row: SampleRow = {
      instanceId,
      swarmId: result.outcome === "no_swarm_record" || result.outcome === "ambiguous" ? null : swarmId,
      collectedAt: collectedAtFromUnixSeconds(result.collectedAt ?? result.reading.collectedAt, now),
      inputBytes: toBigInt(result.reading.inputBytes),
      inputRecords: toBigInt(result.reading.inputRecords),
      containers: containersJson(result.reading.containers),
      status: result.reading.status,
    };
    await insertSample(row);
    return { kind: "recorded" };
  } catch {
    logSkip(instanceId, "failed", "UNEXPECTED");
    return {
      kind: "failed",
      error: { instanceId, outcome: "failed", reasonCode: "UNEXPECTED" },
    };
  }
}

export async function runFluentbitStatsSampler(
  now: Date = new Date(),
): Promise<FluentbitStatsSamplerSummary> {
  console.log(`${LOG_PREFIX} sampler start`);

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
    console.warn(`${LOG_PREFIX} swarm lookup failed; continuing with null swarmId`);
  }

  const outcomes = await mapWithConcurrency(live, READ_CONCURRENCY, (instance) =>
    sampleInstance(instance, swarmIds, now),
  );

  let recorded = 0;
  let failed = 0;
  const errors: FluentbitStatsSamplerError[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "recorded") {
      recorded += 1;
    } else {
      failed += 1;
      errors.push(outcome.error);
    }
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS);
  let pruned = 0;
  try {
    const prunedResult = await db.fluentbitStatsSample.deleteMany({
      where: { collectedAt: { lt: cutoff } },
    });
    pruned = prunedResult?.count ?? 0;
  } catch {
    console.warn(`${LOG_PREFIX} prune failed`);
  }

  console.log(
    `${LOG_PREFIX} sampler done recorded=${recorded} failed=${failed} skipped=${skipped} pruned=${pruned}`,
  );

  return { recorded, failed, skipped, pruned, errors };
}
