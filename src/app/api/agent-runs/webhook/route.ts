/**
 * POST /api/agent-runs/webhook?id=<runId>&token=<rawToken>
 *
 * Session-less callback for agent runs that outlive the Vercel lambda that
 * kicked them off (the "webhook fan-back safety net"). The swarm POSTs here
 * when a run reaches a terminal state; Hive claims the `AgentRun` arbitration
 * row exactly once and delivers by `agentKind`:
 *   - "workflow_explorer" (canvas-linked): fans the result into the owning
 *     canvas conversation.
 *   - "graph_chat": stores the result on the row itself (in the same
 *     updateMany that claims it) and Pusher-nudges the workspace channel so
 *     the Graph Explorer chat sidebar refetches.
 *
 * The payload is what stakgraph's `postTerminalWebhook` actually sends
 * (stakgraph `mcp/src/repo/index.ts`) — the swarm POSTs the registered
 * `webhookUrl` verbatim with `Content-Type: application/json` and NO custom
 * headers, so the bearer token must ride in the URL itself:
 *   - `{ request_id, status: "completed", result: { success, final_answer,
 *     content, tool_use, usage, logs, sessionId } }` on success
 *   - `{ request_id, status: "failed", error }` on failure/abort (also sent
 *     by stakgraph's startup sweep for runs orphaned by a process restart)
 *
 * Security design (defense in depth):
 *   1. Middleware allowlist — `/api/agent-runs/webhook` is tagged `access:
 *      "webhook"` in `ROUTE_POLICIES` so the unauthenticated swarm call
 *      reaches this handler (not the auth redirect).
 *   2. Rate limiting — keyed by run id + source IP; 429 returned before any
 *      DB lookup/claim to blunt brute-force and flooding.
 *   3. Token in the query string (`token=`) because the swarm relays no
 *      custom headers. The exposure of a URL-borne bearer in proxy/access
 *      logs is blunted by the token being single-use (the atomic claim
 *      consumes it), high-entropy (256 bits), stored only as a SHA-256
 *      hash, and useless after the run reaches a terminal state.
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
import { AgentRunStatus, Prisma } from "@prisma/client";
import { timingSafeEqual } from "@/lib/encryption";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  fanOutAgentRunToCanvas,
  hardenContent,
} from "@/services/canvas-agent-run-fanout";
import { notifyGraphAgentRunUpdated } from "@/lib/pusher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST body shape stakgraph's `postTerminalWebhook` sends (see the contract
 * in the file header). `result` is present on "completed", `error` on "failed".
 */
interface WebhookPayload {
  /** Swarm request_id — observability only; the run is keyed by `?id=`. */
  request_id?: string;
  /**
   * Terminal run status from the swarm.
   * "completed" → DELIVERED_WEBHOOK; anything else (failed) → FAILED.
   */
  status?: string;
  /** Terminal result on success: `{ content, final_answer, ... }`. */
  result?: {
    content?: unknown;
    final_answer?: unknown;
    /**
     * stakgraph SessionReflection sidecar — present when the run read any
     * gitree Concepts (reads are always recorded; rank/evidence/gap only
     * when the dispatch opted into the reflect pass). Stored on graph_chat
     * rows; ignored for canvas runs.
     */
    reflection?: unknown;
  } | null;
  /** Error detail on failure (e.g. "aborted", or an exception message). */
  error?: unknown;
}

/** Hash a raw token with SHA-256 (hex digest). */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Max serialized size accepted for the reflection sidecar (same cap as content). */
const MAX_REFLECTION_LENGTH = 128 * 1024;

/**
 * Harden the external reflection payload: must be a plain object and fit the
 * size cap. Returns null when missing/malformed/oversized — the run is still
 * delivered normally; reflection is a best-effort sidecar, never load-bearing.
 */
function hardenReflection(raw: unknown): Prisma.InputJsonObject | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    if (JSON.stringify(raw).length > MAX_REFLECTION_LENGTH) return null;
  } catch {
    return null;
  }
  return raw as Prisma.InputJsonObject;
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
  // stakgraph's webhook sender attaches no custom headers, so the token
  // rides in the query string of the registered webhookUrl.
  const rawToken = request.nextUrl.searchParams.get("token");
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
      agentKind: true,
      workspaceId: true,
      workspaceSlug: true,
      sessionId: true,
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

  // stakgraph nests the terminal result: `result.content` is the (possibly
  // schema-structured) answer, `result.final_answer` the raw text. Prefer
  // `content` only when it's a usable string so a structured object never
  // stringifies to "[object Object]" in the conversation.
  const rawContent =
    typeof payload.result?.content === "string" && payload.result.content.trim()
      ? payload.result.content
      : (payload.result?.final_answer ?? payload.result?.content);
  const isSuccess =
    typeof payload.status === "string" &&
    payload.status.toLowerCase() === "completed";

  // Harden external content before touching the DB.
  const content = hardenContent(rawContent);
  if (isSuccess && content === null) {
    console.warn("[canvas-agent-run-fanout] webhook: oversized/malformed content — treating as failed", { runId });
    // Demote to FAILED — we cannot accept the oversized payload.
  }

  const effectiveStatus: AgentRunStatus =
    isSuccess && content !== null ? AgentRunStatus.DELIVERED_WEBHOOK : AgentRunStatus.FAILED;
  // Preserve the swarm's error detail (e.g. "aborted", an exception message)
  // on the row; hardenContent caps/coerces it like any external string.
  const errorDetail = hardenContent(payload.error) ?? payload.status ?? "failed";
  const errorField =
    effectiveStatus === AgentRunStatus.FAILED
      ? (isSuccess ? "Oversized or malformed result payload" : errorDetail)
      : undefined;

  // On failure, hand the fan-out the error detail — it composes its own
  // `did not complete: <detail>` note for the conversation bubble.
  const fanOutContent =
    effectiveStatus === AgentRunStatus.DELIVERED_WEBHOOK
      ? content!
      : (isSuccess ? "oversized or malformed result payload" : errorDetail);

  // graph_chat runs have no canvas conversation — the row itself is the
  // delivery destination: the terminal result (and the Concept-reads
  // reflection sidecar, when present) is stored on it in the same updateMany
  // that claims it, and the workspace channel gets a nudge.
  const isGraphChat = row.agentKind === "graph_chat";
  const reflection = isGraphChat
    ? hardenReflection(payload.result?.reflection)
    : null;

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
        ...(isGraphChat && effectiveStatus === AgentRunStatus.DELIVERED_WEBHOOK
          ? { result: content!, ...(reflection ? { reflection } : {}) }
          : {}),
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

    // ── graph_chat delivery: result is on the row — nudge the workspace ───
    // No canvas fan-out. The slug is snapshotted on the row at create time
    // (webhook path stays DB-light); fall back to one indexed lookup for
    // rows created before the snapshot existed.
    if (isGraphChat) {
      let slug = row.workspaceSlug;
      if (!slug && row.workspaceId) {
        const ws = await db.workspace.findUnique({
          where: { id: row.workspaceId },
          select: { slug: true },
        });
        slug = ws?.slug ?? null;
      }
      if (slug) {
        notifyGraphAgentRunUpdated(slug, {
          runId,
          sessionId: row.sessionId,
          status: effectiveStatus,
        });
      } else {
        console.warn("[graph-agent-chat] webhook: no workspace slug for run — skipping nudge", {
          runId,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Fan out to canvas conversation ────────────────────────────────────
    // AgentRun is generalized: conversationId is null for non-canvas run
    // types, which have their own webhook endpoints. A null here means the
    // row was misrouted to this canvas-specific endpoint — the claim above
    // still recorded the terminal state; there is just nowhere to deliver.
    // (`orgId` joined the guard when it became nullable for graph_chat rows;
    // canvas rows always carry it, so behavior for them is unchanged.)
    if (!row.conversationId || !row.orgId) {
      console.warn("[canvas-agent-run-fanout] webhook: row has no conversationId — claimed without fan-out", {
        runId,
      });
      return NextResponse.json({ ok: true, note: "no delivery target" });
    }
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
