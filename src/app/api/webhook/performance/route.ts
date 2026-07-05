import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-keys";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { resolveRepoKey } from "@/lib/utils/error-fingerprint";
import { computeTraceSignature, deriveDbTimeMs, type Span } from "@/lib/utils/trace-signature";
import {
  createSketch,
  insert,
  serialize,
  deserialize,
  quantile,
  type SerializedSketch,
} from "@/lib/utils/latency-sketch";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/performance
 *
 * Public, ingest-key-authenticated endpoint for external apps to report
 * performance traces (transactions + child spans) into Hive. Mirrors the
 * /api/webhook/errors conventions.
 *
 * Auth: `Authorization: Bearer <key>` or `x-api-key` header — validated
 * against WorkspaceApiKey via validateApiKey(). No user session required.
 * The resolved workspace is authoritative for ALL subsequent lookups; the
 * request body MUST NOT be trusted for workspace or repo scoping (IDOR guard).
 *
 * Body (JSON):
 *   transactionName  string   — required. e.g. "GET /api/users"
 *   totalDurationMs  number   — required. end-to-end duration in ms
 *   spans?           Array<{ name?, op, startMs?, durationMs }> — optional
 *   repository?      string   — optional. URL or name; resolved to a Repository
 *   environment?     string   — optional. e.g. "production", "staging"
 *   metadata?        object   — optional. arbitrary free-form fields
 *   signature?       string   — optional. client-supplied grouping override
 *
 * Response 201:
 *   { success: true, data: { groupId, eventId, signature, repositoryId, sampleCount, isNew } }
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization") ?? "";
    const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const apiKeyHeader = request.headers.get("x-api-key");
    const rawKey = bearerKey ?? apiKeyHeader;

    if (!rawKey) {
      console.warn("[perf-ingest] auth failed: no key provided");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authResult = await validateApiKey(rawKey);
    if (!authResult) {
      console.warn("[perf-ingest] auth failed: invalid/revoked/expired key");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The workspace from the key is the ONLY authoritative source — never trust body
    const { workspace } = authResult;
    console.info("[perf-ingest] auth ok", { workspaceId: workspace.id, keyId: authResult.apiKey.id });

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const transactionName =
      typeof body.transactionName === "string" ? body.transactionName.trim() : null;
    const totalDurationMs =
      typeof body.totalDurationMs === "number" ? body.totalDurationMs : null;

    if (!transactionName) {
      return NextResponse.json({ error: "Missing required field: transactionName" }, { status: 400 });
    }
    if (totalDurationMs === null) {
      return NextResponse.json({ error: "Missing required field: totalDurationMs" }, { status: 400 });
    }

    // spans is optional; span-less transactions are accepted and grouped normally
    const rawSpans = Array.isArray(body.spans) ? body.spans : [];
    const spans: Span[] = rawSpans
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
      .map((s) => ({
        name: typeof s.name === "string" ? s.name : undefined,
        op: typeof s.op === "string" ? s.op : "unknown",
        startMs: typeof s.startMs === "number" ? s.startMs : undefined,
        durationMs: typeof s.durationMs === "number" ? s.durationMs : 0,
      }));

    const repository = typeof body.repository === "string" ? body.repository : null;
    const environment = typeof body.environment === "string" ? body.environment.trim() : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : null;
    const clientSignature = typeof body.signature === "string" ? body.signature : null;

    console.info("[perf-ingest] payload shape", {
      transactionName,
      totalDurationMs,
      spanCount: spans.length,
      hasRepo: !!repository,
      hasClientSignature: !!clientSignature,
    });

    // ── Repo resolution (IDOR-safe: scoped to authenticated workspace only) ──
    const { repositoryId, repoKey } = await resolveRepoKey({
      workspaceId: workspace.id,
      repository,
    });
    console.info("[perf-ingest] repo resolution", {
      repository,
      repositoryId,
      repoKey,
      matched: !!repositoryId,
    });

    // ── Signature ─────────────────────────────────────────────────────────────
    const signature = computeTraceSignature({ transactionName, spans, clientSignature });
    console.info("[perf-ingest] signature", { signature, clientOverride: !!clientSignature });

    // ── Blob upload (raw payload) ─────────────────────────────────────────────
    const blobKey = `performance/${workspace.id}/${repoKey}/${signature}/${Date.now()}.json`;
    const blob = await put(blobKey, JSON.stringify(body), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.info("[perf-ingest] blob uploaded", { blobKey, url: blob.url });

    // ── Upsert PerformanceTraceGroup ──────────────────────────────────────────
    // Unique key: (workspaceId, repoKey, signature).
    const now = new Date();
    const dbTimeMs = deriveDbTimeMs(spans);

    const existingGroup = await db.performanceTraceGroup.findUnique({
      where: {
        workspaceId_repoKey_signature: { workspaceId: workspace.id, repoKey, signature },
      },
    });

    const isNew = !existingGroup;
    let group: { id: string; sampleCount: number; p50Ms: number; p95Ms: number; p99Ms: number; repositoryId: string | null; lastSeenAt: Date };

    if (isNew) {
      // Seed the sketch with the first sample
      const sketch = insert(createSketch(), totalDurationMs);
      group = await db.performanceTraceGroup.create({
        data: {
          workspaceId: workspace.id,
          repositoryId: repositoryId ?? undefined,
          repoKey,
          transactionName,
          signature,
          sampleCount: 1,
          p50Ms: totalDurationMs,
          p95Ms: totalDurationMs,
          p99Ms: totalDurationMs,
          throughput: 1,
          dbTimeMs,
          sketchState: serialize(sketch),
          firstSeenAt: now,
          lastSeenAt: now,
        },
        select: {
          id: true,
          sampleCount: true,
          p50Ms: true,
          p95Ms: true,
          p99Ms: true,
          repositoryId: true,
          lastSeenAt: true,
        },
      });
    } else {
      // Deserialize sketch, insert new sample, recompute percentiles
      const sketch = deserialize(existingGroup.sketchState as unknown as SerializedSketch);
      insert(sketch, totalDurationMs);

      const newCount = existingGroup.sampleCount + 1;
      const elapsedSeconds =
        (now.getTime() - existingGroup.firstSeenAt.getTime()) / 1000 || 1;
      const throughput = newCount / elapsedSeconds;

      // Rolling average for dbTimeMs
      const newDbTimeMs =
        (existingGroup.dbTimeMs * existingGroup.sampleCount + dbTimeMs) / newCount;

      group = await db.performanceTraceGroup.update({
        where: {
          workspaceId_repoKey_signature: { workspaceId: workspace.id, repoKey, signature },
        },
        data: {
          sampleCount: { increment: 1 },
          p50Ms: quantile(sketch, 0.5),
          p95Ms: quantile(sketch, 0.95),
          p99Ms: quantile(sketch, 0.99),
          throughput,
          dbTimeMs: newDbTimeMs,
          sketchState: serialize(sketch),
          lastSeenAt: now,
        },
        select: {
          id: true,
          sampleCount: true,
          p50Ms: true,
          p95Ms: true,
          p99Ms: true,
          repositoryId: true,
          lastSeenAt: true,
        },
      });
    }

    console.info(
      isNew ? "[perf-ingest] PerformanceTraceGroup created" : "[perf-ingest] PerformanceTraceGroup updated",
      { groupId: group.id, signature, repoKey, sampleCount: group.sampleCount }
    );

    // ── Create PerformanceTraceEvent ──────────────────────────────────────────
    const event = await db.performanceTraceEvent.create({
      data: {
        groupId: group.id,
        workspaceId: workspace.id,
        repositoryId: repositoryId ?? undefined,
        repoKey,
        blobUrl: blob.url,
        transactionName,
        totalDurationMs,
        spans: spans as object[],
      },
    });

    // ── Pusher broadcast ──────────────────────────────────────────────────────
    try {
      await pusherServer.trigger(
        getWorkspaceChannelName(workspace.slug),
        PUSHER_EVENTS.PERFORMANCE_GROUP_UPDATED,
        {
          id: group.id,
          repositoryId: group.repositoryId,
          signature,
          isNew,
          sampleCount: group.sampleCount,
          p50Ms: group.p50Ms,
          p95Ms: group.p95Ms,
          p99Ms: group.p99Ms,
          lastSeenAt: group.lastSeenAt,
        }
      );
      console.info("[perf-ingest] Pusher broadcast ok", { groupId: group.id, isNew });
    } catch (err) {
      console.error("[perf-ingest] Pusher broadcast failed (non-fatal)", err);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          groupId: group.id,
          eventId: event.id,
          signature,
          repositoryId: group.repositoryId,
          sampleCount: group.sampleCount,
          isNew,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[perf-ingest] unexpected error", error);
    return NextResponse.json({ error: "Failed to process performance trace" }, { status: 500 });
  }
}
