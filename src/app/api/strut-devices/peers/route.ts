import { NextRequest, NextResponse } from "next/server";
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
 * a revoked device is 401, and the tokens it holds age out.
 *
 * Header: Authorization: Bearer hivedev_…
 * 200: { actor, peers: [{ id, baseUrl, token, label, description?, repos? }], expiresAt, errors: [{ org, error }] }
 * 401: unknown or revoked credential
 */
export async function GET(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const device = await validateDeviceCredential(bearer);
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await strutPeersForUser(device.userId));
  } catch (error) {
    logger.error("Strut device peers failed", "STRUT_DEVICES", { deviceId: device.deviceId, error });
    return NextResponse.json({ error: "Failed to load peers" }, { status: 500 });
  }
}
