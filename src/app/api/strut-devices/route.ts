import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { listStrutDevices } from "@/lib/strut-devices";

/**
 * GET /api/strut-devices
 *
 * The signed-in person's paired strut devices (the settings page's list).
 * 200: { devices: [{ id, name, credentialPrefix, createdAt, lastUsedAt }] }
 */
export async function GET(request: NextRequest) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  return NextResponse.json({ devices: await listStrutDevices(userOrResponse.id) });
}
