import { NextRequest, NextResponse } from "next/server";
import { authorizeJamieRequest } from "@/lib/tribes/jamie";
import { readTribeOutbox } from "@/lib/tribes/tribeOutbox";
import { getBaseUrl } from "@/lib/utils";

/**
 * GET /api/tribes/outbox?wait=<seconds> — what Jamie has to do in its
 * tribes (`lib/tribes/tribeOutbox.ts`): joins and leaves, notices, and the
 * replies of every linked tribe's conversation since its cursor, each
 * handed out until `/api/tribes/outbox/ack` names it. Jamie's token, like
 * `/api/tribes/messages`.
 *
 * A long poll, as `/api/calls/messages` is: with `wait`, the request is
 * held until something lands or the wait is over, so one loop for every
 * tribe delivers a job's wake hours later like any reply.
 *
 * 200 { messages: [{ id, tribe, text, replyTo?, metadata? } | { id, join } | { id, leave }] }
 */
export const maxDuration = 60;

const MAX_WAIT_SECONDS = 25;
/** As often as `/api/calls/messages` reads. */
const POLL_MS = 1_000;

export async function GET(request: NextRequest) {
  const refused = authorizeJamieRequest(request, "tribes/outbox");
  if (refused) return refused;

  const waitParam = request.nextUrl.searchParams.get("wait");
  const wait = waitParam ? Number(waitParam) : 0;
  if (!Number.isFinite(wait) || wait < 0) {
    return NextResponse.json({ error: `wait must be 0–${MAX_WAIT_SECONDS} seconds` }, { status: 400 });
  }
  const deadline = Date.now() + Math.min(wait, MAX_WAIT_SECONDS) * 1000;
  // An artifact with no address of its own opens in the tribe's conversation in Hive.
  const base = getBaseUrl(request.headers.get("host"));

  try {
    for (;;) {
      const messages = await readTribeOutbox(base);
      if (messages.length > 0) return NextResponse.json({ messages });
      const left = deadline - Date.now();
      if (left <= 0 || request.signal.aborted) return NextResponse.json({ messages: [] });
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, left)));
    }
  } catch (err) {
    console.error("[tribes/outbox] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
