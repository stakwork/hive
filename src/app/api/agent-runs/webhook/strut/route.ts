/**
 * POST /api/agent-runs/webhook/strut?id=<runId>&token=<rawToken>
 *
 * Session-less callback for a dispatched strut chat (`dispatch_strut`, see
 * `src/lib/ai/strutTools.ts`). Strut POSTs here at EVERY turn end of the
 * chat — the dispatched turn, and any turn strut later starts itself when a
 * detached run / verify pass settles — plus a bare `settled` event when its
 * background work ends without another turn (strut `src/ai/turn-callback.ts`):
 *
 *   { event: "turn.end" | "settled", chatId, turn, status: "done" | "error",
 *     trigger?, text?, error?: { message }, settled, parked }
 *
 * Each post is fanned into the owning canvas conversation. `settled: true`
 * is the terminal one: it claims the `AgentRun` row (PENDING →
 * DELIVERED_WEBHOOK / FAILED) and schedules the canvas agent's wake.
 *
 * Security mirrors `/api/agent-runs/webhook` (covered by the same
 * `ROUTE_POLICIES` prefix entry): rate limit before any lookup, bearer token
 * in the query string (strut sends no custom headers), constant-time hash
 * compare, delivery target taken from the row and never from the payload.
 * One deliberate difference: the token is MULTI-use while the row is PENDING
 * — a dispatch produces several posts — and dies with the settled claim.
 * Replays are harmless: the fan-out is idempotent on `(run, turn, event)`.
 *
 * NEVER log the raw token or the full callback URL.
 */

import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { AgentRunStatus } from "@prisma/client";
import { timingSafeEqual } from "@/lib/encryption";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { hardenContent } from "@/services/canvas-agent-run-fanout";
import { fanOutStrutToCanvas, strutRowId } from "@/services/canvas-strut-fanout";
import { STRUT_AGENT_KIND } from "@/lib/ai/strutTools";
import { getBaseUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The wake turn runs in `after()` and is a full canvas-agent turn.
export const maxDuration = 800;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("id");
  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`strut-webhook:${runId}:${ip}`, 60, 60);
  if (!allowed) {
    console.warn("[strut-webhook] rate limit hit", { runId, ip });
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} },
    );
  }

  const rawToken = request.nextUrl.searchParams.get("token");
  if (!rawToken) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

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
      agentKind: true,
      workspaceSlug: true,
      sessionId: true,
    },
  });
  if (!row || row.agentKind !== STRUT_AGENT_KIND) {
    timingSafeEqual(hashToken(rawToken), "0".repeat(64)); // constant-time dummy compare
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!timingSafeEqual(hashToken(rawToken), row.tokenHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Settled, superseded by a later dispatch, or failed at initiation — the
  // token is spent. 200 so strut does not retry.
  if (row.status !== AgentRunStatus.PENDING) {
    return NextResponse.json({ ok: true, note: "already settled" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = payload.event === "settled" ? "settled" : payload.event === "turn.end" ? "turn.end" : null;
  const chatId = typeof payload.chatId === "string" ? payload.chatId : null;
  const turn =
    typeof payload.turn === "number" && Number.isInteger(payload.turn) && payload.turn >= 0 ? payload.turn : null;
  if (!event || !chatId || chatId.length > 200 || turn === null) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }
  // The row knows its chat once the dispatch returned; a post that beats
  // that write (a turn that fails instantly) is vouched for by the token.
  if (row.sessionId && row.sessionId !== chatId) {
    console.warn("[strut-webhook] chat id mismatch", { runId });
    return NextResponse.json({ error: "Chat mismatch" }, { status: 400 });
  }

  const status = payload.status === "error" ? "error" : "done";
  const settled = payload.settled === true;
  const text = hardenContent(payload.text);
  const error = hardenContent((payload.error as { message?: unknown } | null | undefined)?.message);
  const oversized = status === "done" && payload.text != null && text === null;

  if (!row.conversationId || !row.orgId || !row.workspaceSlug) {
    console.warn("[strut-webhook] row has no delivery target", { runId });
    return NextResponse.json({ ok: true, note: "no delivery target" });
  }

  const fanOut = {
    runId,
    title: row.title,
    workspaceSlug: row.workspaceSlug,
    chatId,
    turn,
    event,
    status: oversized ? "error" : status,
    text,
    error: oversized ? "reply too large to post — read it with check_strut_chat" : error,
    settled,
    parked: payload.parked === true,
  } as const;
  const result = await fanOutStrutToCanvas(
    { conversationId: row.conversationId, orgId: row.orgId, userId: row.userId },
    fanOut,
  );
  if (result === "failed") {
    // 5xx so strut retries; nothing was claimed and the fan-out is idempotent.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!settled) {
    if (!row.sessionId) {
      await db.agentRun.updateMany({ where: { id: runId, sessionId: null }, data: { sessionId: chatId } });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Terminal: token-gated claim, then wake the canvas agent ─────────────
  const failed = fanOut.status === "error";
  const { count } = await db.agentRun.updateMany({
    where: { id: runId, tokenHash: row.tokenHash, status: AgentRunStatus.PENDING },
    data: {
      status: failed ? AgentRunStatus.FAILED : AgentRunStatus.DELIVERED_WEBHOOK,
      sessionId: chatId,
      ...(failed ? { error: fanOut.error ?? "failed" } : {}),
      ...(!failed && text ? { result: text } : {}),
    },
  });
  console.log("[strut-webhook] settled", { runId, turn, event, status: fanOut.status, claimed: count > 0 });

  // The claim is the exactly-once gate (a retry that re-delivers a settled
  // post finds the row already claimed above, or loses this updateMany).
  if (count > 0) {
    const conversationId = row.conversationId;
    const workspaceSlug = row.workspaceSlug;
    // Strut reached us here, so this host is swarm-reachable — a follow-up
    // dispatch on the wake turn builds its callback URL from it.
    const publicBaseUrl = getBaseUrl(request.headers.get("host"));
    after(async () => {
      try {
        const { invokeCanvasAgentOnStrutSettled } = await import("@/services/canvas-strut-autoturn");
        await invokeCanvasAgentOnStrutSettled({
          conversationId,
          wakeId: strutRowId(fanOut),
          workspaceSlug,
          chatId,
          title: row.title,
          failed,
          publicBaseUrl,
        });
      } catch (e) {
        console.error("[strut-webhook] canvas auto-turn (after) failed (non-fatal):", e);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
