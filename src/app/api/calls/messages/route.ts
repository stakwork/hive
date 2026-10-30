import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callArtifactUrl, callMessagesSince } from "@/lib/calls/callMessages";
import { peekCallRecord } from "@/lib/calls/callRecord";
import { authorizeCallRequest } from "@/lib/calls/callRequest";
import { getBaseUrl } from "@/lib/utils";

/**
 * GET /api/calls/messages?since=<cursor>&wait=<seconds> — what Jamie said
 * on a call's conversation since the cursor (`lib/calls/callMessages.ts`),
 * for voice to post in the call's chat and say. Machine-to-machine, gated
 * like `/api/calls/turn`.
 *
 * `requests=1` adds what was asked of Jamie on the call, with who asked:
 * for the replay to someone who joins, who sees both sides.
 *
 * A long poll: with `wait`, the request is held until something new lands
 * or the wait is over, so one loop for the whole call delivers a reply
 * twenty minutes later — a job's wake — like any other. It waits through a
 * call with no conversation yet too: the first turn creates one.
 */
export const maxDuration = 60;

const MAX_WAIT_SECONDS = 25;
/** As often as the sync route reads for its reply (`awaitOrchestratorReply`). */
const POLL_MS = 1_000;

async function conversationRows(conversationId: string): Promise<unknown[]> {
  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { messages: true },
  });
  return Array.isArray(conversation?.messages) ? (conversation.messages as unknown[]) : [];
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCallRequest(request, "calls/messages");
  if (auth instanceof NextResponse) return auth;
  const { callKey } = auth;
  let { record } = auth;

  const params = request.nextUrl.searchParams;
  const since = params.get("since") || null;
  if (since !== null && Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: "since is not a cursor this endpoint gave" }, { status: 400 });
  }
  const waitParam = params.get("wait");
  const wait = waitParam ? Number(waitParam) : 0;
  if (!Number.isFinite(wait) || wait < 0) {
    return NextResponse.json({ error: `wait must be 0–${MAX_WAIT_SECONDS} seconds` }, { status: 400 });
  }
  const deadline = Date.now() + Math.min(wait, MAX_WAIT_SECONDS) * 1000;
  const requests = params.get("requests") === "1";

  // An artifact with no address of its own opens in the conversation in Hive.
  const base = getBaseUrl(request.headers.get("host"));
  const org = record.orgId
    ? await db.sourceControlOrg.findUnique({ where: { id: record.orgId }, select: { githubLogin: true } })
    : null;

  for (;;) {
    if (!record.conversationId) record = (await peekCallRecord(callKey)) ?? record;
    if (record.conversationId) {
      const conversationUrl = `${base}/org/${encodeURIComponent(org?.githubLogin ?? "")}?chat=${encodeURIComponent(record.conversationId)}`;
      const page = callMessagesSince(
        await conversationRows(record.conversationId),
        since,
        (ref) => callArtifactUrl(ref, { base, conversationUrl }),
        { requests },
      );
      if (page.messages.length > 0) return NextResponse.json(page);
    }
    const left = deadline - Date.now();
    if (left <= 0 || request.signal.aborted) return NextResponse.json({ cursor: since, messages: [] });
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, left)));
  }
}
