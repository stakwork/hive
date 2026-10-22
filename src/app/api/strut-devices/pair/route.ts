import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { PAIRING_POLL_INTERVAL_SECONDS, PAIRING_TTL_SECONDS, startPairing } from "@/lib/strut-devices";
import { getBaseUrl } from "@/lib/utils";

/**
 * POST /api/strut-devices/pair
 *
 * A device (the desktop strut app) asks for a pairing code — the device
 * authorization request of the OAuth device flow (`lib/strut-devices.ts`).
 * No credential: the device has none yet (a `webhook` route in the
 * middleware). The device shows `userCode` and a QR of
 * `verificationUriComplete`, then polls `POST /api/strut-devices/pair/token`.
 *
 * Body (optional): { name?: string } — how the device is listed.
 * 200: { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown } | null;
  try {
    const started = await startPairing(body?.name);
    const verificationUri = `${getBaseUrl(request.headers.get("host"))}/pair`;
    return NextResponse.json({
      deviceCode: started.deviceCode,
      userCode: started.userCode,
      verificationUri,
      verificationUriComplete: `${verificationUri}?code=${started.userCode}`,
      expiresIn: PAIRING_TTL_SECONDS,
      interval: PAIRING_POLL_INTERVAL_SECONDS,
    });
  } catch (error) {
    logger.error("Strut device pairing could not start", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to start pairing" }, { status: 500 });
  }
}
