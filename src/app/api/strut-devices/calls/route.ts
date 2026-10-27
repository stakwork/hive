import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { startCall } from "@/lib/calls/startCall";

/**
 * POST /api/strut-devices/calls — a paired device starts a Jamie call
 *
 * Authenticated by the device credential alone (a `webhook` route in the
 * middleware). Starts an org-scope call in the workspace as the device's person.
 *
 * Header: Authorization: Bearer hivedev_…
 * Body:   { workspace: "<slug>" }
 * 200: { url }
 * 400: no workspace / workspace has no org / swarm not active
 * 401: unknown or revoked credential
 * 403: no access to the workspace or its org
 * 404: no such workspace
 * 502: Jamie dispatch failed (nothing left behind)
 * 503: LiveKit not configured
 */
export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const device = await validateDeviceCredential(bearer);
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const workspace = body && typeof body === "object" ? (body as { workspace?: unknown }).workspace : undefined;
    if (typeof workspace !== "string" || !workspace) {
      return NextResponse.json({ error: "workspace is required" }, { status: 400 });
    }

    const result = await startCall({ userId: device.userId, slug: workspace });
    if ("url" in result) return NextResponse.json({ url: result.url });
    const status = result.reason === "livekit_unconfigured" ? 503 : result.status;
    return NextResponse.json({ error: result.error }, { status });
  } catch (error) {
    logger.error("Strut device call failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to start call" }, { status: 500 });
  }
}
