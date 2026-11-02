import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { queueTribeLeave, TRIBE_LINK_VIEW_SELECT, tribeLinkView } from "@/lib/tribes/tribeLinks";

function bearerOf(request: NextRequest): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
}

/**
 * PATCH /api/strut-devices/tribes/<pubkey> { sendersMarked: boolean } — the
 * device's person records whether Jamie is marked to see who speaks in a
 * tribe they linked (stakwork/sphinx `docs/tribe-sender-identity.md`): true
 * after their device marked it, false when they turned it off. On the link,
 * not the device, so another device of theirs, or a restore, does not mark
 * it again after it was turned off; the tribe server cannot tell "never
 * marked" from "turned off".
 *
 * Header: Authorization: Bearer hivedev_…
 * 200 { tribe: { pubkey, host, name, workspace, org, sendersMarked, createdAt } }, as GET lists it
 * 400: a body without a boolean `sendersMarked`
 * 401: unknown or revoked credential
 * 404: not a tribe this person linked
 *
 * Works whether or not Jamie is still configured, like DELETE: it records
 * what the person's device did.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ pubkey: string }> }) {
  try {
    const device = await validateDeviceCredential(bearerOf(request));
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { sendersMarked?: unknown } | null;
    const marked = body && typeof body === "object" ? body.sendersMarked : undefined;
    if (typeof marked !== "boolean") {
      return NextResponse.json({ error: "sendersMarked must be true or false" }, { status: 400 });
    }

    const pubkey = (await params).pubkey.trim().toLowerCase();
    const mine = { tribePubkey: pubkey, userId: device.userId };
    const { count } = await db.tribeLink.updateMany({
      where: mine,
      data: { sendersMarkedAt: marked ? new Date() : null },
    });
    // Someone else's link is not found, as DELETE treats it.
    if (count === 0) return NextResponse.json({ error: "Tribe not linked" }, { status: 404 });
    const link = await db.tribeLink.findFirst({ where: mine, select: TRIBE_LINK_VIEW_SELECT });
    if (!link) return NextResponse.json({ error: "Tribe not linked" }, { status: 404 });
    logger.info("Tribe senders mark recorded", "STRUT_DEVICES", { tribe: pubkey, sendersMarked: marked });
    return NextResponse.json({ tribe: tribeLinkView(link) });
  } catch (error) {
    logger.error("Strut device tribe mark failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to record the mark" }, { status: 500 });
  }
}

/**
 * DELETE /api/strut-devices/tribes/<pubkey> — "No Jamie": the device's
 * person unlinks a tribe they linked (`/api/strut-devices/tribes`). The link
 * goes, so the tribe's mentions are refused from now on, and Jamie is told
 * to leave. The tribe's conversations stay in Hive.
 *
 * Header: Authorization: Bearer hivedev_…
 * 200 { unlinked: true }
 * 401: unknown or revoked credential
 * 404: not a tribe this person linked
 *
 * Unlinking works whether or not Jamie is still configured: it only ever
 * takes something away.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ pubkey: string }> }) {
  try {
    const device = await validateDeviceCredential(bearerOf(request));
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const pubkey = (await params).pubkey.trim().toLowerCase();
    const { count } = await db.tribeLink.deleteMany({ where: { tribePubkey: pubkey, userId: device.userId } });
    if (count === 0) return NextResponse.json({ error: "Tribe not linked" }, { status: 404 });
    await queueTribeLeave(pubkey);
    logger.info("Tribe unlinked", "STRUT_DEVICES", { tribe: pubkey });
    return NextResponse.json({ unlinked: true });
  } catch (error) {
    logger.error("Strut device tribe unlink failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to unlink the tribe" }, { status: 500 });
  }
}
