import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS,
  utcCalendarDate,
} from "@/services/swarm/storage-janitor";
import type { HostStorageService } from "@/services/swarm/host-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SwarmStorageHistoryPoint {
  date: string;
  usedBytes: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  status: string;
}

export interface SwarmStorageLatestSnapshot extends SwarmStorageHistoryPoint {
  instanceId: string;
  reasonCode: string | null;
  mount: string | null;
  services: HostStorageService[];
  collectedAt: string | null;
}

export interface SwarmStorageInstancePayload {
  latest: SwarmStorageLatestSnapshot | null;
  history: SwarmStorageHistoryPoint[];
}

export type SwarmStorageHistoryResponse = Record<string, SwarmStorageInstancePayload>;

const SNAPSHOT_SELECT = {
  instanceId: true,
  date: true,
  status: true,
  reasonCode: true,
  totalBytes: true,
  usedBytes: true,
  freeBytes: true,
  mount: true,
  services: true,
  collectedAt: true,
} as const;

function bigintToNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asServices(value: unknown): HostStorageService[] {
  if (!Array.isArray(value)) return [];
  const services: HostStorageService[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string") continue;
    const sizeBytes =
      typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes) ? row.sizeBytes : null;
    services.push({
      name: row.name,
      sizeBytes,
      sizeKnown: row.sizeKnown === true && sizeBytes != null,
    });
  }
  return services;
}

function retentionCutoff(now: Date = new Date()): Date {
  const cutoff = utcCalendarDate(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - SWARM_STORAGE_SNAPSHOT_RETENTION_DAYS);
  return cutoff;
}

/**
 * GET /api/admin/swarms/storage — latest snapshot + retention-window history
 * per EC2 instance, for the admin swarms dashboard.
 *
 * Super-admin gated BEFORE any DB read. Explicit column select only — never
 * `include` the related Swarm (it carries swarmPassword and other secrets).
 * BigInt byte columns are converted to `number | null` before JSON.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const rows = await db.swarmStorageSnapshot.findMany({
      where: { date: { gte: retentionCutoff() } },
      select: SNAPSHOT_SELECT,
      orderBy: [{ instanceId: "asc" }, { date: "asc" }],
    });

    const payload: SwarmStorageHistoryResponse = {};

    for (const row of rows) {
      const date = dateOnly(row.date);
      if (!date) continue;

      const historyPoint: SwarmStorageHistoryPoint = {
        date,
        usedBytes: bigintToNumber(row.usedBytes),
        totalBytes: bigintToNumber(row.totalBytes),
        freeBytes: bigintToNumber(row.freeBytes),
        status: row.status,
      };

      const latest: SwarmStorageLatestSnapshot = {
        ...historyPoint,
        instanceId: row.instanceId,
        reasonCode: row.reasonCode,
        mount: row.mount,
        services: asServices(row.services),
        collectedAt: isoDateTime(row.collectedAt),
      };

      const existing = payload[row.instanceId];
      if (existing) {
        existing.history.push(historyPoint);
        existing.latest = latest;
      } else {
        payload[row.instanceId] = {
          latest,
          history: [historyPoint],
        };
      }
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching swarm storage history:", error);
    return NextResponse.json({ error: "Failed to fetch storage history" }, { status: 500 });
  }
}
