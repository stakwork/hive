/**
 * POST /api/ask/abort
 *
 * With a `turnId` (the composer's Stop button): signals that one turn to
 * stop via Redis and cancels its pending strut runs — see the per-turn
 * block below. Without one (the header "Stop investigation" button):
 * cancels all in-flight repo_agent runs for a canvas conversation.
 *
 * Security-critical order of operations:
 *   1. Authenticate (401 if no session)
 *   2. Rate-limit (generous, idempotent)
 *   3. Validate org membership (403/404 before any resource access)
 *   4. Resolve conversation + IDOR check
 *   5. Cancel the conversation's PENDING strut runs (code-change
 *      previews) on THEIR swarm — from the `StrutRun` row, never the policy
 *   6. Mark abortRequested on all active runs (atomic)
 *   7. Re-resolve swarm creds per run + proxy abort to stakgraph (strut
 *      runs, keyed by their `StrutRun.id`, are skipped — step 5 did them)
 *   8. If no runs registered yet, write pending-abort intent
 *
 * Never returns the raw activeRuns map; never logs secrets.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  requestAbortForAllRuns,
  areAllRunsAlreadyAborted,
  setPendingAbortIntent,
} from "@/services/canvas-active-runs";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { cancelPendingStrutRunsForConversation } from "@/services/strut-runs";
import {
  isValidTurnId,
  requestTurnAbort,
  TurnAbortUnavailable,
} from "@/services/canvas-turn-abort";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ── 1. Authenticate first ───────────────────────────────────────────
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  // ── Parse body ───────────────────────────────────────────────────────
  let body: { conversationId?: string; orgId?: string; turnId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { conversationId, orgId, turnId } = body;

  if (
    (!conversationId || typeof conversationId !== "string") &&
    (!turnId || typeof turnId !== "string")
  ) {
    return NextResponse.json(
      { error: "conversationId or turnId is required" },
      { status: 400 },
    );
  }
  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (turnId !== undefined && typeof turnId === "string" && !isValidTurnId(turnId)) {
    return NextResponse.json({ error: "Invalid turnId" }, { status: 400 });
  }

  // ── 2. Rate-limit (generous — users must never be 429'd from Stop) ──
  // Keyed by userId + (conversationId ?? turnId) so repeated Stop clicks
  // are cheap even on the very first turn (no conversationId yet).
  const rlKey = `abort:${userId}:${conversationId ?? turnId}`;
  const rl = await checkRateLimit(rlKey, 60, 60); // 60 req/min
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  // ── 3. Validate org membership BEFORE any resource access ───────────
  const isMember = await validateUserBelongsToOrg(orgId, userId, "id");
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // ════════════════════════════════════════════════════════════════════
  // Per-turn Stop path (`turnId` present — the composer's Stop button).
  // NEVER falls through to the conversation-wide path below.
  //
  // The Redis key is the whole signal: the instance generating the turn
  // polls it and aborts the reply stream, the tool loop (repo_agent runs
  // tell stakgraph to stop themselves — they hold the swarm creds and
  // request_id) and any sub-agents not yet started. The only thing that
  // outlives the turn's own instance is a PENDING strut run (a code-change
  // preview or job) the turn dispatched, so that is cancelled here.
  // ════════════════════════════════════════════════════════════════════
  if (typeof turnId === "string" && turnId.length > 0) {
    let requested: Awaited<ReturnType<typeof requestTurnAbort>>;
    try {
      requested = await requestTurnAbort({ turnId, userId, orgId });
    } catch (err) {
      if (err instanceof TurnAbortUnavailable) {
        console.warn("[quick-ask] turn-abort-unavailable", { turnId, op: "request" });
        return NextResponse.json({ error: "Abort temporarily unavailable" }, { status: 503 });
      }
      throw err;
    }
    console.log("[quick-ask] turn-abort-requested", { turnId, userId, ownerMatched: !!requested.owner });

    if (!requested.owner) {
      // Not registered yet, or caller isn't the owner. Identical response
      // either way so nobody can probe who owns a turn.
      return NextResponse.json({ accepted: true }, { status: 202 });
    }

    const { rowId, startedAt } = requested.owner;
    try {
      const strut = await cancelPendingStrutRunsForConversation(rowId, {
        userId,
        since: new Date(startedAt),
      });
      if (strut.rows.length > 0) {
        console.log(`[abort] turn strut runs: ${strut.cancelled}/${strut.rows.length} cancelled turnId: ${turnId}`);
      }
    } catch (err) {
      console.warn("[abort] turn strut cancel failed (non-fatal):", String(err));
    }

    return NextResponse.json({ accepted: true, conversationId: rowId }, { status: 202 });
  }

  // ════════════════════════════════════════════════════════════════════
  // Conversation-wide path (no turnId — the header "Stop investigation"
  // button). Behavior below this point is unchanged.
  // ════════════════════════════════════════════════════════════════════
  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // ── 4. IDOR: resolve conversation (must belong to this org + caller) ─
  const rowId = await resolveOrgConversationRowId({ conversationId, userId, orgId });
  if (!rowId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  console.log(`[abort] conversationId: ${rowId} userId: ${userId}`);

  // ── 5. Pending strut runs (code-change previews) → strut cancel ──────
  // A preview runs on strut, not on the swarm's /repo/agent. Its row knows
  // its swarm, so the cancel goes there; the callback then settles the row
  // as `cancelled` and the card flips. Idempotent: a settled row is no
  // longer PENDING, so a repeat Stop finds nothing. Never blocks the rest.
  let strutCancelled = 0;
  const strutRunIds = new Set<string>();
  try {
    const strut = await cancelPendingStrutRunsForConversation(rowId);
    strutCancelled = strut.cancelled;
    for (const row of strut.rows) strutRunIds.add(row.id);
    if (strut.rows.length > 0) {
      console.log(`[abort] strut runs: ${strut.cancelled}/${strut.rows.length} cancelled for conversationId: ${rowId}`);
    }
  } catch (err) {
    console.warn("[abort] strut cancel failed (non-fatal):", String(err));
  }

  // ── Idempotency: if all runs already aborted, short-circuit ─────────
  const alreadyDone = await areAllRunsAlreadyAborted(rowId);
  if (alreadyDone) {
    console.log(`[abort] All runs already aborted for conversationId: ${rowId}`);
    return NextResponse.json({ ok: true, aborted: strutCancelled });
  }

  // ── 6. Get active runs & mark abortRequested atomically ─────────────
  const activeRuns = await requestAbortForAllRuns(rowId);

  // ── Start-race: no runs registered yet → write pending-abort intent ──
  if (activeRuns.length === 0) {
    if (turnId && typeof turnId === "string") {
      await setPendingAbortIntent(rowId, turnId);
      console.log(`[abort] No active runs yet; wrote pending-abort intent for turnId: ${turnId}`);
    } else {
      console.log(`[abort] No active runs and no turnId; nothing to cancel for conversationId: ${rowId}`);
    }
    return NextResponse.json({ ok: true, aborted: strutCancelled });
  }

  // ── 7. Proxy abort to stakgraph for each run ─────────────────────────
  let abortedCount = 0;
  for (const run of activeRuns) {
    // A strut run's entry is keyed by its StrutRun id — cancelled above,
    // on strut; there is no /repo/agent request behind it.
    if (strutRunIds.has(run.requestId)) continue;
    // Re-resolve swarm creds from workspaceId (never trust a persisted URL).
    const swarmResult = await getSwarmAccessByWorkspaceId(run.workspaceId);
    if (!swarmResult.success) {
      // Swarm gone inactive/not configured — local cancellation already set;
      // Hive's poll loop will exit on the abortRequested flag.
      console.warn(
        `[abort] Could not resolve swarm for workspaceId: ${run.workspaceId} — local cancellation only. error: ${swarmResult.error.type}`,
      );
      continue;
    }

    const { swarmUrl, swarmApiKey } = swarmResult.data;

    // Proxy the abort with one retry on transient failure.
    let confirmed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${swarmUrl}/repo/agent/abort`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": swarmApiKey,
          },
          body: JSON.stringify({ request_id: run.requestId }),
        });
        console.log(`[abort] stakgraph abort HTTP status: ${res.status} requestId: ${run.requestId}`);
        if (res.ok) {
          confirmed = true;
          break;
        }
        // Non-2xx on attempt 0 → retry once.
      } catch (err) {
        console.warn(`[abort] stakgraph abort fetch error attempt ${attempt}:`, String(err));
      }
    }

    if (!confirmed) {
      console.warn(
        `[abort] Unconfirmed halt: stakgraph did not acknowledge abort for requestId: ${run.requestId}. Local cancellation still honored.`,
      );
    } else {
      abortedCount++;
    }
  }

  console.log(`[abort] Done. abortedCount: ${abortedCount}/${activeRuns.length} strut: ${strutCancelled} conversationId: ${rowId}`);
  return NextResponse.json({ ok: true, aborted: abortedCount + strutCancelled });
}
