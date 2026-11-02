import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { lightningPubkeyFields, normalizeLightningPubkey, userByLightningPubkey } from "@/lib/auth/lightning-pubkey";
import { verifySphinxToken } from "@/lib/auth/sphinx-verify";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";

/**
 * POST /api/strut-devices/sphinx — "this is my Sphinx account"
 *
 * A paired device (Peel) registers its person's Sphinx pubkey, proved with
 * the token the Sphinx apps sign (`verifySphinxToken`: a 4-byte timestamp and
 * the node key's signature over it, five minutes old at most). From then on
 * a tribe mention whose `sender` is that pubkey runs as this person
 * (`/api/tribes/messages`; stakwork/sphinx `docs/tribe-sender-identity.md`).
 * It is stored as Hive's own Sphinx link stores it (`User.lightningPubkey`
 * and its lookup hash). Authenticated by the device credential alone (a
 * `webhook` route in the middleware).
 *
 * Header: Authorization: Bearer hivedev_…
 * Body:   { pubkey: "<66 hex>", token: "<base64>" }
 * 200: { linked: true }  stored now, or already this person's
 * 400: not a pubkey, or a token that does not verify for it
 * 401: unknown or revoked credential
 * 409: { error }         another Hive user holds this pubkey, or this person holds another one
 */
const TAKEN = "This Sphinx account is linked to another Hive user.";
const OTHER = "This Hive user is linked to another Sphinx account: unlink it in Hive's settings first.";

export async function POST(request: NextRequest) {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  const device = await validateDeviceCredential(bearer);
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { pubkey?: unknown; token?: unknown } | null;
  const pubkey = normalizeLightningPubkey(body?.pubkey);
  if (!pubkey)
    return NextResponse.json({ error: "pubkey must be a Sphinx pubkey (66 hex characters)" }, { status: 400 });
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  const verified = verifySphinxToken(token, pubkey);
  if (!verified.valid) return NextResponse.json({ error: verified.reason }, { status: 400 });

  try {
    const holder = await userByLightningPubkey(pubkey);
    if (holder) {
      return holder.id === device.userId
        ? NextResponse.json({ linked: true })
        : NextResponse.json({ error: TAKEN }, { status: 409 });
    }
    // Only a person with no Sphinx account yet: one who has another changes it in Hive.
    const { count } = await db.user.updateMany({
      where: { id: device.userId, lightningPubkey: null },
      data: lightningPubkeyFields(pubkey),
    });
    if (count === 0) return NextResponse.json({ error: OTHER }, { status: 409 });
    logger.info("Sphinx pubkey registered by a paired device", "STRUT_DEVICES", { deviceId: device.deviceId });
    return NextResponse.json({ linked: true });
  } catch (error) {
    // Another person's row took the same pubkey between the read and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: TAKEN }, { status: 409 });
    }
    logger.error("Sphinx pubkey registration failed", "STRUT_DEVICES", { deviceId: device.deviceId, error });
    return NextResponse.json({ error: "Failed to register the Sphinx account" }, { status: 500 });
  }
}
