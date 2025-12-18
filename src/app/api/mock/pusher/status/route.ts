import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Pusher Status Endpoint
 *
 * GET - Inspect current mock state (subscriptions, connections, event history)
 * POST - Reset mock state (for testing)
 *
 * Only available when USE_MOCKS=true
 */

const USE_MOCKS = process.env.USE_MOCKS === "true";

export async function GET(request: NextRequest) {
  if (!USE_MOCKS) {
    return NextResponse.json({ error: "Mock endpoints are disabled. Set USE_MOCKS=true to enable." }, { status: 404 });
  }

  try {
    const subscriptions = mockPusherState.getSubscriptions();
    const connectionState = mockPusherState.getConnectionState();
    const eventHistory = mockPusherState.getEventHistory(50); // Last 50 events

    return NextResponse.json({
      success: true,
      message: "Mock Pusher status",
      data: {
        subscriptions: {
          total: subscriptions.length,
          channels: subscriptions.map((sub) => ({
            channel: sub.channelName,
            event: sub.eventName,
            callbackCount: sub.callbackCount,
          })),
        },
        connection: connectionState,
        recentEvents: eventHistory.map((event) => ({
          channel: event.channelName,
          event: event.eventName,
          timestamp: event.timestamp,
          // Don't include full data payload to keep response manageable
        })),
      },
    });
  } catch (error) {
    console.error("[Mock Pusher] Error getting status:", error);
    return NextResponse.json(
      {
        error: "Failed to get mock Pusher status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!USE_MOCKS) {
    return NextResponse.json({ error: "Mock endpoints are disabled. Set USE_MOCKS=true to enable." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "reset";

    if (action === "reset") {
      mockPusherState.reset();
      return NextResponse.json({
        success: true,
        message: "Mock Pusher state reset successfully",
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[Mock Pusher] Error processing POST:", error);
    return NextResponse.json(
      {
        error: "Failed to process mock Pusher request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
