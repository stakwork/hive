import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getResolvedPreferences,
  validatePreferencesUpdate,
} from "@/lib/notifications/preferences";

/**
 * GET /api/user/notification-preferences
 *
 * Returns the authenticated user's full notification preferences object,
 * with defaults applied for any missing keys. Supports both session cookies
 * and Bearer token auth (for iOS/mobile clients).
 *
 * Responses:
 * - 200: Full resolved preferences object (all 11 types)
 * - 401: Not authenticated
 * - 404: User not found
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { notificationPreferences: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(getResolvedPreferences(user.notificationPreferences));
}

/**
 * PATCH /api/user/notification-preferences
 *
 * Partially updates the authenticated user's notification preferences.
 * Accepts a partial object of { [NotificationTriggerType]: boolean }.
 * Missing keys in the body are left unchanged. Merged result is returned.
 *
 * Responses:
 * - 200: Updated full resolved preferences object
 * - 400: Invalid key or non-boolean value
 * - 401: Not authenticated
 * - 404: User not found
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  let update: ReturnType<typeof validatePreferencesUpdate>;
  try {
    update = validatePreferencesUpdate(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Fetch current stored prefs to merge into
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { notificationPreferences: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const current =
    user.notificationPreferences && typeof user.notificationPreferences === "object"
      ? (user.notificationPreferences as Record<string, unknown>)
      : {};

  const merged = { ...current, ...update };

  await db.user.update({
    where: { id: userId },
    data: { notificationPreferences: merged },
  });

  logger.info("Notification preferences updated", "NOTIFICATION_PREFERENCES", {
    userId,
    updatedKeys: Object.keys(update),
  });

  return NextResponse.json(getResolvedPreferences(merged));
}
