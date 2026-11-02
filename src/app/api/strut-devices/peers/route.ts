import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { strutPeersForUser } from "@/services/strut-device-peers";

/**
 * GET /api/strut-devices/peers — "my strut peers"
 *
 * A paired device's renewal (`lib/strut-devices.ts`): fresh peer records,
 * with fresh 7-day tokens, for the orgs its person belongs to NOW — a new
 * org appears, a left one is gone, a moved swarm has its new URL. The
 * device calls it daily and replaces its peers with the answer. Authenticated
 * by the device credential alone (a `webhook` route in the middleware);
 * a revoked device is 401, and the tokens it holds age out. `sphinx`: Hive
 * knows the person's Sphinx pubkey, so a tribe can name them as the one
 * asking Jamie; the device registers it with `POST /api/strut-devices/sphinx`.
 *
 * Header: Authorization: Bearer hivedev_…
 * 200: { actor, peers: [{ id, baseUrl, token, label, description?, repos? }], expiresAt, errors: [{ org, error }], sphinx }
 * 401: unknown or revoked credential
 */
export async function GET(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const device = await validateDeviceCredential(bearer);
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [peers, user] = await Promise.all([
      strutPeersForUser(device.userId),
      db.user.findUnique({ where: { id: device.userId }, select: { lightningPubkey: true } }),
    ]);
    return NextResponse.json({ ...peers, sphinx: Boolean(user?.lightningPubkey) });
  } catch (error) {
    logger.error("Strut device peers failed", "STRUT_DEVICES", { deviceId: device.deviceId, error });
    return NextResponse.json({ error: "Failed to load peers" }, { status: 500 });
  }
}
