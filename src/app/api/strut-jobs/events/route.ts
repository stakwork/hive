/**
 * POST /api/strut-jobs/events?id=<StrutRun.id>&token=<rawToken>
 *
 * Where a strut JOB tells hive what changed as it happens (strut
 * `plans/live-artifacts.md`, `specs/CALLBACKS.md` §5). Every job turn hive
 * launches registers this URL as the launch's `jobCallback`, under that
 * turn's row and token (`dispatchStrutRun`); strut keeps the latest on the
 * job, so a shot the agent takes, a walkthrough's frames, a pod it holds,
 * a check's verdict — this turn's or a Verify's days later — all arrive
 * here, one small event each:
 *
 *   { event: "job.update", job, at, runId?, kind, url?, id?, title?, state?, detail? }
 *
 * An event is a NOTIFICATION, never the record: it points at something
 * hive can read again (a job file through the reader route, the claims
 * ledger), so this route stores nothing. It forwards the event to the
 * job's conversation over Pusher (`CANVAS_JOB_UPDATE`), where the working
 * card and the claims card show it live; and when a Verify ends (`kind:
 * "verify", state: "done"`) it publishes the claims card's next version,
 * which a detached Verify (`verifyJobClaims`) left to this moment — only
 * for a Verify a person started (`publishVerifiedVersion` decides); the
 * job's agent verifying its own turn ends without a row.
 *
 * Security mirrors the run webhook: a rate limit before any lookup, the
 * bearer token in the query string (strut sends no custom headers),
 * constant-time hash compare against the row's, and the event must be
 * about the row's own job. NEVER log the raw token or the full URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { timingSafeEqual } from "@/lib/encryption";
import { notifyCanvasJobUpdate, type CanvasJobUpdate } from "@/lib/pusher";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { JOB_TURN_KIND, forwardableJobUrl } from "@/lib/strut-jobs";
import { firstJobTurn } from "@/services/strut-jobs";
import { publishVerifiedVersion } from "@/services/strut-jobs/claims";
import { hashStrutRunToken } from "@/services/strut-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Verify's end re-reads the ledger and writes a row: a few seconds at most. */
export const maxDuration = 60;

/** A frame a second, at most, from one job — and a verify pass's burst of evidence. */
const RATE_PER_MINUTE = 240;
/** `detail` is small by contract (`{ frames: 3 }`); a bigger one is dropped, never forwarded past Pusher's cap. */
const DETAIL_MAX_CHARS = 4_000;

const text = (max: number) => z.string().min(1).max(max);

const updateSchema = z.object({
  event: z.literal("job.update"),
  job: text(200),
  at: text(64),
  kind: text(64),
  runId: text(200).optional(),
  url: text(2_000).optional(),
  id: text(300).optional(),
  title: text(500).optional(),
  state: text(64).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.length > 64) return NextResponse.json({ error: "Missing run id" }, { status: 400 });

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`strut-job-events:${id}:${ip}`, RATE_PER_MINUTE, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} });
  }

  const rawToken = request.nextUrl.searchParams.get("token");
  if (!rawToken) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

  const row = await db.strutRun.findUnique({
    where: { id },
    select: { id: true, tokenHash: true, kind: true, jobId: true, swarmId: true, conversationId: true },
  });
  if (!row) {
    timingSafeEqual(hashStrutRunToken(rawToken), "0".repeat(64)); // constant-time dummy compare
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!timingSafeEqual(hashStrutRunToken(rawToken), row.tokenHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (row.kind !== JOB_TURN_KIND || !row.jobId) return NextResponse.json({ error: "Not a job turn" }, { status: 400 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  const u = parsed.data;
  // The token vouches for one job: an update about another is refused (4xx: strut does not retry it).
  if (u.job !== row.jobId) return NextResponse.json({ error: "Job mismatch" }, { status: 400 });

  const url = forwardableJobUrl(u.url, row.jobId);
  const detail = u.detail && JSON.stringify(u.detail).length <= DETAIL_MAX_CHARS ? u.detail : undefined;
  const update: CanvasJobUpdate = {
    jobId: row.jobId,
    swarmId: row.swarmId,
    at: u.at,
    kind: u.kind,
    ...(u.runId ? { runId: u.runId } : {}),
    ...(url ? { url } : {}),
    ...(u.id ? { id: u.id } : {}),
    ...(u.title ? { title: u.title } : {}),
    ...(u.state ? { state: u.state } : {}),
    ...(detail ? { detail } : {}),
  };
  if (row.conversationId) notifyCanvasJobUpdate(row.conversationId, update);

  // A Verify that ended: the card's next version, which a detached Verify
  // left to this moment. Awaited — the function may not outlive the response.
  if (u.kind === "verify" && u.state === "done") {
    const first = await firstJobTurn(row.jobId);
    if (first) {
      try {
        await publishVerifiedVersion(first, row.jobId, u.runId ?? null);
      } catch (err) {
        console.warn("[strut-job-events] claims card not published (non-fatal)", { id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
