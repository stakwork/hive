import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authorizeJamieRequest, SPHINX_PUBKEY_RE } from "@/lib/tribes/jamie";

/**
 * POST /api/tribes/left — Jamie was removed from a linked tribe: its owner
 * kicked it, or deleted the tribe (stakwork/sphinx `wasm/daemon`). The link
 * goes, as an unlink does (`DELETE /api/strut-devices/tribes/<pubkey>`): the
 * tribe shows unlinked in Peel, and its mentions and log are refused from
 * now on. No leave is queued — Jamie is out already — and the tribe's
 * conversations stay in Hive. Machine-to-machine: Jamie's token
 * (`lib/tribes/jamie.ts`).
 *
 * Body: { tribe: "<pubkey>", reason: "kicked" | "deleted", time? }
 *
 * Answers, as the daemon reads them:
 *   200 { unlinked: true }  the link is gone
 *   404                     not linked (any more): done
 *   400                     not a removal
 */
export async function POST(request: NextRequest) {
  const refused = authorizeJamieRequest(request, "tribes/left");
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tribe = typeof body?.tribe === "string" ? body.tribe.trim().toLowerCase() : "";
  const reason = body?.reason;
  if (!SPHINX_PUBKEY_RE.test(tribe)) return NextResponse.json({ error: "tribe must be a tribe's pubkey" }, { status: 400 });
  if (reason !== "kicked" && reason !== "deleted") {
    return NextResponse.json({ error: "reason must be kicked or deleted" }, { status: 400 });
  }
  try {
    const { count } = await db.tribeLink.deleteMany({ where: { tribePubkey: tribe } });
    if (count === 0) return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });
    logger.info("Tribe unlinked: Jamie was removed", "STRUT_DEVICES", { tribe, reason });
    return NextResponse.json({ unlinked: true });
  } catch (error) {
    logger.error("Tribe removal failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
