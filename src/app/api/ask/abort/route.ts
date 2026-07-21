/**
 * POST /api/ask/abort
 *
 * Cancels all in-flight repo_agent runs for a canvas conversation.
 * Security-critical order of operations:
 *   1. Authenticate (401 if no session)
 *   2. Rate-limit (generous, idempotent)
 *   3. Validate org membership (403/404 before any resource access)
 *   4. Resolve conversation + IDOR check
 *   5. Mark abortRequested on all active runs (atomic)
 *   6. Re-resolve swarm creds per run + proxy abort to stakgraph
 *   7. If no runs registered yet, write pending-abort intent
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
  getActiveRuns,
  areAllRunsAlreadyAborted,
  setPendingAbortIntent,
} from "@/services/canvas-active-runs";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";

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

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  // ── 2. Rate-limit (generous — users must never be 429'd from Stop) ──
  // Keyed by userId + conversationId so repeated Stop clicks are cheap.
  const rlKey = `abort:${userId}:${conversationId}`;
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

  // ── 4. IDOR: resolve conversation (must belong to this org + caller) ─
  const rowId = await resolveOrgConversationRowId({ conversationId, userId, orgId });
  if (!rowId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  console.log(`[abort] conversationId: ${rowId} userId: ${userId}`);

  // ── Idempotency: if all runs already aborted, short-circuit ─────────
  const alreadyDone = await areAllRunsAlreadyAborted(rowId);
  if (alreadyDone) {
    console.log(`[abort] All runs already aborted for conversationId: ${rowId}`);
    return NextResponse.json({ ok: true, aborted: 0 });
  }

  // ── 5. Get active runs & mark abortRequested atomically ─────────────
  const activeRuns = await requestAbortForAllRuns(rowId);

  // ── Start-race: no runs registered yet → write pending-abort intent ──
  if (activeRuns.length === 0) {
    if (turnId && typeof turnId === "string") {
      await setPendingAbortIntent(rowId, turnId);
      console.log(`[abort] No active runs yet; wrote pending-abort intent for turnId: ${turnId}`);
    } else {
      console.log(`[abort] No active runs and no turnId; nothing to cancel for conversationId: ${rowId}`);
    }
    return NextResponse.json({ ok: true, aborted: 0 });
  }

  // ── 6. Proxy abort to stakgraph for each run ─────────────────────────
  let abortedCount = 0;
  for (const run of activeRuns) {
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

  console.log(`[abort] Done. abortedCount: ${abortedCount}/${activeRuns.length} conversationId: ${rowId}`);
  return NextResponse.json({ ok: true, aborted: abortedCount });
}
