import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { queueTribeLeave } from "@/lib/tribes/tribeLinks";

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
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const device = await validateDeviceCredential(bearer);
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
