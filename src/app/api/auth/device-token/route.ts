import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/device-token
 *
 * Registers or clears device push notification tokens on the authenticated user's record.
 *
 * Request body (all fields optional):
 * - ios_device_token?: string — absent = no-op, "" = clear, non-empty = store
 *
 * Responses:
 * - 200 { success: true }
 * - 401: No active session
 * - 500: DB error
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty or non-JSON body — treat as no fields provided
  }

  // Build update data only for recognised fields that are present in the body
  const updateData: { iosDeviceToken?: string | null } = {};

  if ("ios_device_token" in body) {
    const raw = body.ios_device_token;
    if (typeof raw === "string") {
      // Empty string → clear; non-empty → store
      updateData.iosDeviceToken = raw === "" ? null : raw;
    }
  }

  // If no recognised fields were present, nothing to update
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  try {
    await db.user.update({
      where: { id: userId },
      data: updateData,
    });

    logger.info("Device token updated", "DEVICE_TOKEN", { userId });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to update device token", "DEVICE_TOKEN", { error, userId });
    return NextResponse.json({ error: "Failed to update device token" }, { status: 500 });
  }
}
