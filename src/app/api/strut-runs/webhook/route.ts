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
 * One payload is not the row's own run: a JOB strut's orchestrator started
 * inside strut (`job/start`, strut CALLBACKS.md §4 "A job your run
 * started"). That job's run carries the ORCHESTRATOR turn's callback, so
 * its `run.end` lands here with `workflow: "job"` and the job id, under an
 * `orchestrator_turn` row. Hive launched nothing, so no row exists for it;
 * the webhook ADOPTS it — the `job_turn` row for (swarm, run id), minted
 * when the orchestrator turn settled or here if the job beat it
 * (`services/strut-runs/orchestrator-jobs.ts`), routed from the orchestrator row, settled through the same
 * `completeStrutRun` — and the job's reply, cards and reader links land
 * exactly as a hive-launched job's do (`services/strut-runs/job-turn.ts`).
 * Only `job` and `runId` are read off the payload for that; a replay finds
 * the row it minted and takes the settled path.
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
import { JOB_WORKFLOW } from "@/lib/strut-jobs";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { getBaseUrl } from "@/lib/utils";
import { completeStrutRun, hashStrutRunToken, type StrutRunTerminalStatus } from "@/services/strut-runs";
import { STRUT_RUN_WEBHOOK_SELECT, adoptOrchestratorJobRun } from "@/services/strut-runs/orchestrator-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 2 MB diff through hygiene plus a row-locked patch — seconds, not minutes.
export const maxDuration = 60;

const TERMINAL: ReadonlySet<string> = new Set<StrutRunTerminalStatus>(["success", "error", "cancelled"]);
/** Cap on `error.message` — an external string headed for a DB column and a card. */
const MAX_ERROR_CHARS = 4_000;

/** A job id as strut accepts one (its session-id format; hive mints UUIDs). */
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Cap on a title read off the payload for an adopted job. */
const MAX_TITLE_CHARS = 300;

const WEBHOOK_SELECT = STRUT_RUN_WEBHOOK_SELECT;

type WebhookRow = {
  id: string;
  tokenHash: string;
  status: StrutRunStatus;
  workflow: string;
  strutRunId: string | null;
  kind: string;
  workspaceId: string;
  swarmId: string;
  userId: string;
  conversationId: string | null;
};

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

  const authed: WebhookRow | null = await db.strutRun.findUnique({ where: { id }, select: WEBHOOK_SELECT });
  if (!authed) {
    timingSafeEqual(hashStrutRunToken(rawToken), "0".repeat(64)); // constant-time dummy compare
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!timingSafeEqual(hashStrutRunToken(rawToken), authed.tokenHash)) {
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
  if (payload.event !== "run.end" || !status || !runId) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  // The row the payload settles: the authenticated one, or — under an
  // orchestrator turn, for a `job` run that turn started inside strut — the
  // job's own row, adopted here. Every other (row, workflow) pair must match.
  let row = authed;
  if (authed.kind === ORCHESTRATOR_TURN_KIND && payload.workflow === JOB_WORKFLOW && authed.workflow !== JOB_WORKFLOW) {
    const job = typeof payload.job === "string" && JOB_ID.test(payload.job) ? payload.job : null;
    if (!job) {
      return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
    }
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim().slice(0, MAX_TITLE_CHARS) : null;
    row = await adoptOrchestratorJobRun(authed, { job, runId, title });
    console.log("[strut-runs-webhook] adopted a job the orchestrator started", { id, jobRow: row.id, job, status: row.status });
  }
  if (payload.workflow !== row.workflow) {
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

  // Strut reached us on this host, so it is swarm-reachable: a handler that
  // wakes the canvas agent hands it on for the launches that turn makes.
  const ctx = { publicBaseUrl: getBaseUrl(request.headers.get("host")) };

  if (row.status !== StrutRunStatus.PENDING) {
    // Already settled (a replay, or reconcile got there first). The handler
    // re-runs idempotently so a delivery that failed after the claim lands;
    // 200 either way unless it fails again — strut may retry that.
    const outcome = await completeStrutRun(row, { status }, ctx);
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

  const outcome = await completeStrutRun(row, completion, ctx);
  console.log("[strut-runs-webhook] settled", { id, kind: row.kind, status, outcome });
  if (outcome === "retry") {
    // 5xx so strut retries; the claim stands and the handler is idempotent.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, outcome });
}
