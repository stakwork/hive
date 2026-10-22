import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { checkPairing, consumePairing } from "@/lib/strut-devices";
import { strutPeersForUser } from "@/services/strut-device-peers";

/**
 * POST /api/strut-devices/pair/token
 *
 * The device's poll — the device access token request of the OAuth device
 * flow (`lib/strut-devices.ts`). No credential but the device code (a
 * `webhook` route in the middleware).
 *
 * Body: { deviceCode: string }
 * 400: { error: "authorization_pending" } — not approved yet; poll again after `interval`
 *      { error: "access_denied" }         — the person denied it
 *      { error: "expired_token" }         — expired, unknown, or already collected; start over
 * 200, once: { credential, device: { id, name }, actor, peers, expiresAt, errors }
 *      — `credential` is the device's own (`Authorization: Bearer` on
 *      `GET /api/strut-devices/peers`); `peers` are `PUT /peers/:id` bodies
 *      for the local strut (`services/strut-device-peers.ts`).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { deviceCode?: unknown } | null;
  try {
    const polled = await checkPairing(body?.deviceCode);
    if (polled.status !== "approved") return NextResponse.json({ error: polled.status }, { status: 400 });

    // Minted before the pairing is spent: a failure here leaves it for the next poll.
    const peers = await strutPeersForUser(polled.userId);
    const issued = await consumePairing(polled);
    if (!issued) return NextResponse.json({ error: "expired_token" }, { status: 400 });

    logger.info("Strut device paired", "STRUT_DEVICES", {
      userId: polled.userId,
      deviceId: issued.device.id,
      peers: peers.peers.length,
    });
    return NextResponse.json({ credential: issued.credential, device: issued.device, ...peers });
  } catch (error) {
    logger.error("Strut device poll failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to complete pairing" }, { status: 500 });
  }
}
