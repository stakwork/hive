/**
 * Pusher Mock Polling API
 *
 * Provides HTTP polling endpoint for SSR scenarios where in-memory state
 * isn't directly accessible. Clients can poll for events on specific channels.
 *
 * GET /api/mock/pusher/events?channels=task-123,workspace-myworkspace&since=1234567890
 *
 * Returns events for specified channels since the given timestamp.
 */

import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";

const USE_MOCKS = process.env.USE_MOCKS === "true";

export async function GET(request: NextRequest) {
  // Only available in mock mode
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are disabled" },
      { status: 404 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const channelsParam = searchParams.get("channels");
    const sinceParam = searchParams.get("since");

    // Validate required parameters
    if (!channelsParam) {
      return NextResponse.json(
        { error: "Missing required parameter: channels" },
        { status: 400 }
      );
    }

    // Parse channels (comma-separated)
    const channels = channelsParam.split(",").map((ch) => ch.trim());

    // Parse since timestamp (optional)
    const since = sinceParam ? parseInt(sinceParam, 10) : undefined;

    // Poll for events
    const events = mockPusherState.poll(channels, since);

    return NextResponse.json({
      success: true,
      data: events,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Error polling Pusher mock events:", error);
    return NextResponse.json(
      {
        error: "Failed to poll events",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Get mock statistics (for debugging)
 */
export async function POST(request: NextRequest) {
  // Only available in mock mode
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are disabled" },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (action === "stats") {
      const stats = mockPusherState.getStats();
      return NextResponse.json({
        success: true,
        data: stats,
      });
    }

    if (action === "reset") {
      mockPusherState.reset();
      return NextResponse.json({
        success: true,
        message: "Mock state reset successfully",
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Supported actions: stats, reset" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in Pusher mock action:", error);
    return NextResponse.json(
      {
        error: "Failed to execute action",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
