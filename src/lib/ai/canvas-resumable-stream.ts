/**
 * Tier-2 delivery seam for org-canvas Jamie turns.
 *
 * Persistence stays `canvas-turn-persistence.ts` (user row at send,
 * assistant rows only at the end). This module only changes *delivery*:
 * the UI message stream is published through AI-SDK `resumable-stream`
 * over hive's ioredis so a refresh can replay buffered SSE and then
 * follow the live turn.
 *
 * The resumable context is created lazily on first create/resume. Importing
 * this module (including from conversation GET, which only reads the
 * active-turn pointer) must not open a Redis socket.
 */
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import { redis } from "@/lib/redis";

/** Same bound as `maxDuration` on `/api/ask/quick`. Pointer TTL safety net. */
export const CANVAS_STREAM_TTL_SECONDS = 800;

export interface CanvasActiveStream {
  streamId: string;
  turnId: string;
}

const activeStreamKey = (conversationRowId: string) =>
  `canvas:active-stream:${conversationRowId}`;

let contextPromise: Promise<ResumableStreamContext> | null = null;

/**
 * Lazy factory. `createResumableStreamContext` is imported inside the
 * function so a module import never constructs a Redis client. The
 * subscriber is `redis.duplicate()` — ioredis cannot subscribe on the
 * same connection that issues regular commands, and the lock client
 * must not be reused either.
 */
async function getStreamContext(): Promise<ResumableStreamContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const { createResumableStreamContext } = await import(
        "resumable-stream/ioredis"
      );
      const { after } = await import("next/server");
      return createResumableStreamContext({
        waitUntil: after,
        publisher: redis,
        subscriber: redis.duplicate(),
      });
    })().catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

export function parseActiveStream(raw: string | null): CanvasActiveStream | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasActiveStream>;
    if (
      typeof parsed.streamId === "string" &&
      parsed.streamId.length > 0 &&
      typeof parsed.turnId === "string" &&
      parsed.turnId.length > 0
    ) {
      return { streamId: parsed.streamId, turnId: parsed.turnId };
    }
  } catch {
    // Corrupt pointer — treat as no in-flight stream.
  }
  return null;
}

/**
 * Read the active-turn pointer. Redis is optional: a thrown GET logs and
 * returns null so a history load that only needs Postgres never 500s.
 */
export async function readActiveStream(
  conversationRowId: string,
): Promise<CanvasActiveStream | null> {
  try {
    const raw = await redis.get(activeStreamKey(conversationRowId));
    return parseActiveStream(raw);
  } catch (err) {
    console.error(
      "❌ [quick-ask] Redis fallback reading active stream:",
      err,
    );
    return null;
  }
}

/**
 * Point `canvas:active-stream:{rowId}` at this turn. `streamId === turnId`.
 * Throws on Redis failure so the caller can fall back to a non-resumable
 * send — the pointer must not be advertised if it wasn't written.
 */
export async function writeActiveStream(
  conversationRowId: string,
  turnId: string,
): Promise<void> {
  const pointer: CanvasActiveStream = { streamId: turnId, turnId };
  await redis.set(
    activeStreamKey(conversationRowId),
    JSON.stringify(pointer),
    "EX",
    CANVAS_STREAM_TTL_SECONDS,
  );
}

/**
 * Clear the pointer after the assistant turn has been persisted. TTL is
 * the crash/failed-clear safety net, so a delete failure is logged and
 * swallowed — the expired pointer falls through the 204 path.
 */
export async function clearActiveStream(
  conversationRowId: string,
): Promise<void> {
  try {
    await redis.del(activeStreamKey(conversationRowId));
  } catch (err) {
    console.error(
      "❌ [quick-ask] Failed to clear active stream pointer:",
      err,
    );
  }
}

/**
 * Publish `uiStream` as a resumable SSE body. The caller still builds the
 * response with `createUIMessageStreamResponse` — this only supplies the
 * string stream `consumeSseStream` should forward to Redis. Does not
 * consume `result.fullStream`; persist's `consumeStream()` stays the sole
 * consumer of that.
 */
export async function createCanvasResumableStream(
  streamId: string,
  uiStream: ReadableStream<string>,
): Promise<ReadableStream<string> | null> {
  const ctx = await getStreamContext();
  console.log("[quick-ask] stream create", { streamId });
  return ctx.createNewResumableStream(streamId, () => uiStream);
}

/**
 * Replay buffered SSE for `streamId`, then continue live. `null` means the
 * stream is already done; `undefined` means there is no such stream.
 */
export async function resumeCanvasStream(
  streamId: string,
): Promise<ReadableStream<string> | null | undefined> {
  const ctx = await getStreamContext();
  const stream = await ctx.resumeExistingStream(streamId);
  console.log("[quick-ask] stream resume", {
    streamId,
    result: stream ? "hit" : stream === null ? "done" : "miss",
  });
  return stream;
}
