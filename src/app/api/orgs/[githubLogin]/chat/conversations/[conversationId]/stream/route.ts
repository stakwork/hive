/**
 * GET /api/orgs/[githubLogin]/chat/conversations/[conversationId]/stream
 *
 * Thin SSE relay for an in-flight org-canvas turn. Resume is keyed solely
 * by the Redis pointer bound to this conversation id — there is no
 * `?streamId=` query, so a caller cannot point the relay at someone
 * else's stream.
 *
 * Owner-only. In-flight reasoning and unredacted tool payloads are
 * stripped only at persist, so `isShared` is not sufficient.
 *
 * Handler order is IDOR-first: auth, rate-limit, org membership, row
 * lookup — all before any Redis subscriber / SSE is opened.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import {
  readActiveStream,
  resumeCanvasStream,
} from "@/lib/ai/canvas-resumable-stream";

// Same bound as the producer in `/api/ask/quick` so a mid-turn resume
// is not killed before generation finishes.
export const maxDuration = 800;

const NO_STREAM = () => new NextResponse(null, { status: 204 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; conversationId: string }> },
) {
  // 1. Authenticate — 401 before any resource access.
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, conversationId } = await params;

  // 2. Rate-limit before opening a Redis subscriber / SSE. Same helper
  // as POST /api/ask/abort, keyed per user per conversation.
  const rlKey = `canvas-stream:${userOrResponse.id}:${conversationId}`;
  const rl = await checkRateLimit(rlKey, 30, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  // 3. Org membership + the same SharedConversation lookup as conversation
  // GET. 404 (not 403) for non-members and non-readable rows.
  const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
  if (!isMember) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const conversation = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: org.id,
    },
    select: { id: true, userId: true, isShared: true },
  });

  if (
    !conversation ||
    (conversation.userId !== userOrResponse.id && !conversation.isShared)
  ) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // 4. Owner-only live buffer. A share-link joiner can read the persisted
  // transcript but must not replay the live SSE.
  if (conversation.userId !== userOrResponse.id) {
    console.log("[quick-ask] stream resume miss", {
      conversationId,
      reason: "not-owner",
    });
    return NO_STREAM();
  }

  // 5. Pointer, then resume. Missing / done / Redis-down → 204.
  const pointer = await readActiveStream(conversationId);
  if (!pointer) {
    console.log("[quick-ask] stream resume miss", {
      conversationId,
      reason: "no-pointer",
    });
    return NO_STREAM();
  }

  let resumed: ReadableStream<string> | null | undefined;
  try {
    resumed = await resumeCanvasStream(pointer.streamId);
  } catch (err) {
    console.error("❌ [quick-ask] Redis fallback resuming stream:", err);
    return NO_STREAM();
  }

  if (!resumed) {
    console.log("[quick-ask] stream resume miss", {
      conversationId,
      streamId: pointer.streamId,
      reason: resumed === null ? "done" : "missing",
    });
    return NO_STREAM();
  }

  console.log("[quick-ask] stream resume hit", {
    conversationId,
    streamId: pointer.streamId,
    turnId: pointer.turnId,
  });

  // `resumeExistingStream` yields strings. The Fetch Response body must
  // be bytes — undici rejects a string chunk.
  const encoder = new TextEncoder();
  const bytes = resumed.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(encoder.encode(chunk));
      },
    }),
  );

  return new Response(bytes, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
