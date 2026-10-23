import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { revokeStrutDevice } from "@/lib/strut-devices";

/**
 * DELETE /api/strut-devices/[deviceId]
 *
 * Revoke one of the signed-in person's devices: its credential stops
 * renewing peers at once, and the 7-day tokens it holds age out. The row is
 * kept for audit.
 * 200: { success: true } · 404: not theirs, or already revoked
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { deviceId } = await params;
  if (!(await revokeStrutDevice(userOrResponse.id, deviceId))) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
