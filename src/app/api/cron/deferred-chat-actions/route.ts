import { dispatchDueActions } from "@/services/deferred-chat-action-dispatcher";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/deferred-chat-actions
 *
 * Vercel cron endpoint (runs every minute) that picks up PENDING
 * DeferredChatAction records whose `fireAt` has passed, re-runs the original
 * query via the canvas agent, and appends the result to the originating
 * SharedConversation.
 *
 * Gated by:
 *   - `CRON_SECRET` Authorization header (standard cron guard)
 *   - `DEFERRED_CHAT_ACTIONS_ENABLED=true` environment flag
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Verify cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Feature flag guard
    if (process.env.DEFERRED_CHAT_ACTIONS_ENABLED !== "true") {
      console.log(
        "[DeferredChatActions] Disabled via DEFERRED_CHAT_ACTIONS_ENABLED",
      );
      return NextResponse.json({
        success: true,
        message: "Disabled",
        fired: 0,
        failed: 0,
        errors: [],
      });
    }

    // 3. Dispatch due actions
    const result = await dispatchDueActions();

    return NextResponse.json({
      success: result.failed === 0,
      fired: result.fired,
      failed: result.failed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DeferredChatActions] Unhandled error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
