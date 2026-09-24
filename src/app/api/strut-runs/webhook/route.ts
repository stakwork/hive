/**
 * POST /api/strut-runs/webhook?id=<StrutRun.id>&token=<rawToken>
 *
 * THE callback endpoint for every strut workflow hive launches
 * (`services/strut-runs.ts`). Strut POSTs once when the run settles
 * (strut `specs/CALLBACKS.md`):
 *
 *   { event: "run.end", workflow, runId, status: "success" | "error" | "cancelled",
 *     output?, error?: { message }, durationMs }
 *
 * The body is the same for every workflow; only `output` varies, and the
 * ROW's `kind` picks the handler that validates it. Routing (workspace,
 * conversation, proposal, swarm) comes from the row, never the payload.
 *
 * Security mirrors `/api/agent-runs/webhook/strut`: rate limit before any
 * lookup, bearer token in the query string (strut sends no custom
 * headers), constant-time hash compare, and a token-gated idempotent claim
 * PENDING → terminal. A replay of a settled row is a 200 (the handler
 * re-runs idempotently); a handler failure is a 5xx so strut retries.
 *
 * NEVER log the raw token or the full callback URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { StrutRunStatus } from "@prisma/client";
import { timingSafeEqual } from "@/lib/encryption";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { completeStrutRun, hashStrutRunToken, type StrutRunTerminalStatus } from "@/services/strut-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 2 MB diff through hygiene plus a row-locked patch — seconds, not minutes.
export const maxDuration = 60;

const TERMINAL: ReadonlySet<string> = new Set<StrutRunTerminalStatus>(["success", "error", "cancelled"]);
/** Cap on `error.message` — an external string headed for a DB column and a card. */
const MAX_ERROR_CHARS = 4_000;

function hardenError(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === "string" ? raw : String(raw);
  return s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}…` : s;
}

export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`strut-run-webhook:${id}:${ip}`, 30, 60);
  if (!allowed) {
    console.warn("[strut-runs-webhook] rate limit hit", { id, ip });
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} },
    );
  }

  const rawToken = request.nextUrl.searchParams.get("token");
  if (!rawToken) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  const row = await db.strutRun.findUnique({
    where: { id },
    select: { id: true, tokenHash: true, status: true, workflow: true, strutRunId: true, kind: true },
  });
  if (!row) {
    timingSafeEqual(hashStrutRunToken(rawToken), "0".repeat(64)); // constant-time dummy compare
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!timingSafeEqual(hashStrutRunToken(rawToken), row.tokenHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = typeof payload.status === "string" && TERMINAL.has(payload.status) ? (payload.status as StrutRunTerminalStatus) : null;
  const runId = typeof payload.runId === "string" && payload.runId.length > 0 && payload.runId.length <= 200 ? payload.runId : null;
  if (payload.event !== "run.end" || !status || !runId || payload.workflow !== row.workflow) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }
  // The row knows its run id once the dispatch returned; a callback that
  // beats that write (a run that fails instantly) is vouched for by the token.
  if (row.strutRunId && row.strutRunId !== runId) {
    console.warn("[strut-runs-webhook] run id mismatch", { id });
    return NextResponse.json({ error: "Run mismatch" }, { status: 400 });
  }
  if (!row.strutRunId) {
    await db.strutRun.updateMany({ where: { id: row.id, strutRunId: null }, data: { strutRunId: runId } }).catch(() => undefined);
  }

  if (row.status !== StrutRunStatus.PENDING) {
    // Already settled (a replay, or reconcile got there first). The handler
    // re-runs idempotently so a delivery that failed after the claim lands;
    // 200 either way unless it fails again — strut may retry that.
    const outcome = await completeStrutRun(row, { status });
    if (outcome === "retry") {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, note: "already settled" });
  }

  const completion = {
    status,
    output: status === "success" ? payload.output : undefined,
    error: hardenError((payload.error as { message?: unknown } | null | undefined)?.message),
    durationMs: typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs) ? payload.durationMs : null,
  };

  const outcome = await completeStrutRun(row, completion);
  console.log("[strut-runs-webhook] settled", { id, kind: row.kind, status, outcome });
  if (outcome === "retry") {
    // 5xx so strut retries; the claim stands and the handler is idempotent.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, outcome });
}
