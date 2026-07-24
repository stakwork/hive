/**
 * POST /api/agent-runs/webhook?id=<runId>
 *
 * Session-less callback for canvas-linked workflow-explorer runs that outlive
 * the Vercel lambda that kicked them off (the "webhook fan-back safety net").
 * The swarm POSTs here when a run reaches a terminal state; Hive claims the
 * `AgentRun` arbitration row exactly once and fans the result into the owning
 * canvas conversation.
 *
 * Security design (defense in depth):
 *   1. Middleware allowlist — `/api/agent-runs/webhook` is tagged `access:
 *      "webhook"` in `ROUTE_POLICIES` so the unauthenticated swarm call
 *      reaches this handler (not the auth redirect).
 *   2. Rate limiting — keyed by run id + source IP; 429 returned before any
 *      DB lookup/claim to blunt brute-force and flooding.
 *   3. Token in header (`x-agent-run-token`), NOT the query string — the
 *      query carries only the run `id`, so the bearer value is never captured
 *      in proxy/access logs.
 *   4. Constant-time token compare — the incoming token is hashed (SHA-256)
 *      and compared against `tokenHash` via `timingSafeEqual`, never `===`.
 *   5. Atomic, token-gated claim — `updateMany({ where: { id, tokenHash,
 *      status: PENDING } })` so the token check is part of the write itself,
 *      not just a preceding guard. Zero updated rows → inline or cancellation
 *      already won → 200 no-op (exactly-once guarantee).
 *
 * NEVER log the raw token or the full `webhookUrl`. Log only run `id` and
 * parsed status.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { AgentRunStatus } from "@prisma/client";
import { timingSafeEqual } from "@/lib/encryption";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  fanOutAgentRunToCanvas,
  hardenContent,
} from "@/services/canvas-agent-run-fanout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST body shape the swarm is expected to send. */
interface WebhookPayload {
  /** Primary content field. */
  content?: unknown;
  /** Fallback content field (some swarm responses use this key). */
  final_answer?: unknown;
  /**
   * Terminal run status from the swarm.
   * "success" → DELIVERED_WEBHOOK; anything else (failed/aborted) → FAILED.
   */
  status?: string;
}

/** Hash a raw token with SHA-256 (hex digest). */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("id");
  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  // ── Rate limiting (keyed by runId + IP) ─────────────────────────────────
  // Applied BEFORE the DB lookup/claim to blunt token brute-force and
  // request flooding against a public, session-less endpoint.
  const ip = getClientIp(request);
  const rateKey = `agent-run-webhook:${runId}:${ip}`;
  const { allowed, retryAfter } = await checkRateLimit(rateKey, 20, 60);
  if (!allowed) {
    console.warn("[canvas-agent-run-fanout] rate limit hit", { runId, ip });
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: retryAfter ? { "Retry-After": String(retryAfter) } : {},
      },
    );
  }

  // ── Token extraction ─────────────────────────────────────────────────────
  const rawToken = request.headers.get("x-agent-run-token");
  if (!rawToken) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  // ── Row lookup (by id only — no credential yet) ─────────────────────────
  const row = await db.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      tokenHash: true,
      conversationId: true,
      orgId: true,
      userId: true,
      title: true,
      status: true,
    },
  });

  if (!row) {
    // Return 404 only when the row truly doesn't exist. We still do the
    // constant-time compare to avoid a timing side-channel leaking row
    // existence vs. wrong-token.
    timingSafeEqual(hashToken(rawToken), "0".repeat(64)); // constant-time dummy compare
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Constant-time token verification ─────────────────────────────────────
  const incomingHash = hashToken(rawToken);
  if (!timingSafeEqual(incomingHash, row.tokenHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Already claimed? ──────────────────────────────────────────────────────
  if (row.status !== AgentRunStatus.PENDING) {
    console.log("[canvas-agent-run-fanout] webhook: row already claimed — no-op", {
      runId,
      existingStatus: row.status,
    });
    return NextResponse.json({ ok: true, note: "already claimed" });
  }

  // ── Parse terminal payload ───────────────────────────────────────────────
  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawContent = payload.content ?? payload.final_answer;
  const isSuccess =
    typeof payload.status === "string" &&
    payload.status.toLowerCase() === "success";

  const targetStatus: AgentRunStatus = isSuccess
    ? AgentRunStatus.DELIVERED_WEBHOOK
    : AgentRunStatus.FAILED;

  // Harden external content before touching the DB.
  const content = hardenContent(rawContent);
  if (isSuccess && content === null) {
    console.warn("[canvas-agent-run-fanout] webhook: oversized/malformed content — treating as failed", { runId });
    // Demote to FAILED — we cannot accept the oversized payload.
  }

  const effectiveStatus: AgentRunStatus =
    isSuccess && content !== null ? AgentRunStatus.DELIVERED_WEBHOOK : AgentRunStatus.FAILED;
  const errorField =
    effectiveStatus === AgentRunStatus.FAILED
      ? (isSuccess ? "Oversized or malformed result payload" : (payload.status ?? "failed"))
      : undefined;

  const failureNote = `The workflow explorer run "${row.title}" did not complete successfully.`;
  const fanOutContent = effectiveStatus === AgentRunStatus.DELIVERED_WEBHOOK ? content! : failureNote;

  // ── Atomic, token-gated claim ─────────────────────────────────────────────
  // `tokenHash` in the where-clause makes the claim itself credential-gated —
  // not only the preceding compare — so a race with a concurrent webhook call
  // from a different token is safe.
  try {
    const { count } = await db.agentRun.updateMany({
      where: {
        id: runId,
        tokenHash: row.tokenHash, // token-gated claim
        status: AgentRunStatus.PENDING,
      },
      data: {
        status: effectiveStatus,
        ...(errorField ? { error: errorField } : {}),
      },
    });

    if (count === 0) {
      // Inline path or cancellation already claimed the row — exactly-once: no-op.
      console.log("[canvas-agent-run-fanout] webhook: claim lost race (inline/cancel won) — no-op", {
        runId,
        parsedStatus: effectiveStatus,
      });
      return NextResponse.json({ ok: true, note: "already claimed" });
    }

    console.log("[canvas-agent-run-fanout] webhook: claimed", {
      runId,
      parsedStatus: effectiveStatus,
    });

    // ── Fan out to canvas conversation ────────────────────────────────────
    await fanOutAgentRunToCanvas(
      { conversationId: row.conversationId, orgId: row.orgId, userId: row.userId },
      {
        runId,
        agentKind: "workflow_explorer",
        title: row.title,
        content: fanOutContent,
        status: effectiveStatus === AgentRunStatus.DELIVERED_WEBHOOK ? "success" : "failed",
      },
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    // 5xx so the swarm retries — the row is still PENDING (claim never committed).
    console.error("[canvas-agent-run-fanout] webhook: unexpected error", {
      runId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
