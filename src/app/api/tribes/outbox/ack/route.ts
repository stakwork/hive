import { NextRequest, NextResponse } from "next/server";
import { authorizeJamieRequest } from "@/lib/tribes/jamie";
import { ackTribeOutbox } from "@/lib/tribes/tribeOutbox";
import { getBaseUrl } from "@/lib/utils";

/**
 * POST /api/tribes/outbox/ack — the outbox entries Jamie is done with
 * (`lib/tribes/tribeOutbox.ts`): posted, joined, left, or given up on.
 * Jamie's token. An id it does not know, or one acked before, is no error:
 * Jamie acks again what it is handed again.
 *
 * Body: { ids: string[] }
 * 200 { ok: true }
 */
const MAX_IDS = 500;
const MAX_ID_CHARS = 300;

export async function POST(request: NextRequest) {
  const refused = authorizeJamieRequest(request, "tribes/outbox/ack");
  if (refused) return refused;

  const body = await request.json().catch(() => null);
  const ids = body && typeof body === "object" ? (body as { ids?: unknown }).ids : undefined;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_IDS ||
    !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS)
  ) {
    return NextResponse.json({ error: `ids must be a list of up to ${MAX_IDS} outbox ids` }, { status: 400 });
  }

  try {
    await ackTribeOutbox([...new Set(ids as string[])], getBaseUrl(request.headers.get("host")));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tribes/outbox/ack] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
