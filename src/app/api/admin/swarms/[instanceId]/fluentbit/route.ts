import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  readFluentbitStats,
  type FluentbitStatsReadResult,
} from "@/services/swarm/fluentbit-stats-read";
import { HOST_STORAGE_INSTANCE_ID_PATTERN } from "@/services/swarm/host-storage-read";
import { FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS } from "@/services/swarm/fluentbit-stats-sample";
import {
  computeContainersToday,
  computeIngestBuckets,
  utcDayStart,
  type FluentbitContainerToday,
  type FluentbitIngest,
} from "@/services/swarm/fluentbit-stats-rollups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[FluentbitStats]";

const SAMPLE_SELECT = {
  collectedAt: true,
  inputBytes: true,
  inputRecords: true,
  containers: true,
  status: true,
} as const;

export interface FluentbitStatsApiResponse extends FluentbitStatsReadResult {
  ingest: FluentbitIngest | null;
  containersToday: FluentbitContainerToday[] | null;
}

function historyCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - FLUENTBIT_STATS_SAMPLE_RETENTION_DAYS);
  return cutoff;
}

async function loadSamples(instanceId: string, now: Date) {
  try {
    return await db.fluentbitStatsSample.findMany({
      where: {
        instanceId,
        collectedAt: { gte: historyCutoff(now) },
      },
      select: SAMPLE_SELECT,
      orderBy: { collectedAt: "asc" },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} history query failed instance=${instanceId}`, error);
    return [];
  }
}

function attachHistory(
  result: FluentbitStatsReadResult,
  samples: Awaited<ReturnType<typeof loadSamples>>,
  now: Date,
  instanceId: string,
): FluentbitStatsApiResponse {
  let ingest: FluentbitIngest | null = null;
  let containersToday: FluentbitContainerToday[] | null = null;

  try {
    ingest = computeIngestBuckets(samples, now);

    const todayStart = utcDayStart(now);
    const samplesToday = samples.filter((row) => row.collectedAt >= todayStart);
    const samplesBeforeToday = samples.filter((row) => row.collectedAt < todayStart);

    const liveReading = result.reading;
    const liveContainers =
      (result.outcome === "fresh" || result.outcome === "cached") &&
      liveReading &&
      (liveReading.status === "OK" || liveReading.status === "PARTIAL") &&
      liveReading.containers &&
      liveReading.containers.length > 0
        ? liveReading.containers
        : null;

    containersToday = computeContainersToday(
      liveContainers,
      samplesToday,
      samplesBeforeToday,
      now,
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} rollup failed instance=${instanceId}`, error);
    ingest = null;
    containersToday = null;
  }

  return { ...result, ingest, containersToday };
}

/**
 * GET /api/admin/swarms/[instanceId]/fluentbit — live FluentBit stats read
 * plus day-bucketed ingest history from persisted samples.
 *
 * Super-admin gated BEFORE any database read, credential decryption, or
 * outbound swarm call. No connection parameter is ever accepted from the
 * request body or query string; the swarm URL always comes from the DB row.
 * Sample queries are scoped to the path `instanceId` only.
 *
 * Outcome → HTTP mapping matches `/storage`:
 * - fresh / cached               → 200 with the reading
 * - no_swarm_record              → 200
 * - unreachable / failed         → 200 with the outcome + reason code
 * - ambiguous                    → 409
 * - malformed instanceId         → 400
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  if (!HOST_STORAGE_INSTANCE_ID_PATTERN.test(instanceId)) {
    return NextResponse.json(
      { outcome: "failed", reasonCode: "INVALID_INSTANCE_ID", cached: false },
      { status: 400 },
    );
  }

  const now = new Date();

  let result: FluentbitStatsReadResult;
  let samples: Awaited<ReturnType<typeof loadSamples>>;
  try {
    [result, samples] = await Promise.all([
      readFluentbitStats(instanceId),
      loadSamples(instanceId, now),
    ]);
  } catch {
    return NextResponse.json(
      { outcome: "failed", reasonCode: "UNREACHABLE", cached: false },
      { status: 500 },
    );
  }

  const body = attachHistory(result, samples, now, instanceId);

  if (result.outcome === "failed" && result.reasonCode === "INVALID_INSTANCE_ID") {
    return NextResponse.json(result, { status: 400 });
  }
  if (result.outcome === "ambiguous") {
    return NextResponse.json(body, { status: 409 });
  }

  return NextResponse.json(body);
}
