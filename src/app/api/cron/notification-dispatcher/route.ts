import { dispatchPendingNotifications } from "@/services/notification-dispatcher";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/notification-dispatcher
 *
 * Vercel cron endpoint (runs every 5 minutes) that picks up deferred PENDING
 * notification triggers, runs per-type cancellation checks, and either sends
 * or cancels each one.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Feature flag guard
    if (process.env.NOTIFICATION_DISPATCHER_ENABLED !== "true") {
      console.log(
        "[NotificationDispatcher] Notification dispatcher is disabled via NOTIFICATION_DISPATCHER_ENABLED"
      );
      return NextResponse.json({
        success: true,
        message: "Notification dispatcher is disabled",
        dispatched: 0,
        cancelled: 0,
        failed: 0,
        errors: [],
      });
    }

    console.log("[NotificationDispatcher] Starting dispatch run");

    // 3. Run dispatcher
    const result = await dispatchPendingNotifications();

    console.log(
      `[NotificationDispatcher] Dispatch complete — dispatched: ${result.dispatched}, cancelled: ${result.cancelled}, failed: ${result.failed}`
    );

    return NextResponse.json({
      success: result.failed === 0,
      dispatched: result.dispatched,
      cancelled: result.cancelled,
      failed: result.failed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[NotificationDispatcher] Unhandled error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
