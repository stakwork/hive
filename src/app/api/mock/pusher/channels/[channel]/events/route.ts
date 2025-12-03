import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

/**
 * Mock Pusher Events Polling Endpoint
 * 
 * Returns queued events for a channel since a given event ID or timestamp.
 * Used by client-side polling to replace WebSocket event delivery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoint only available in mock mode" },
      { status: 403 }
    );
  }

  try {
    const { channel } = await params;
    const { searchParams } = new URL(request.url);
    const sinceEventId = searchParams.get("since_event_id");
    const sinceTimestamp = searchParams.get("since_timestamp");
    const connectionId = searchParams.get("connection_id");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connection_id" },
        { status: 400 }
      );
    }

    // Verify connection exists
    const connection = mockPusherState.getConnection(connectionId);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // Get events since the specified point
    const events = mockPusherState.getEvents(channel, {
      sinceEventId: sinceEventId || undefined,
      sinceTimestamp: sinceTimestamp ? new Date(sinceTimestamp) : undefined,
    });

    return NextResponse.json({
      events: events.map(e => ({
        id: e.id,
        event: e.event,
        data: e.data,
        timestamp: e.timestamp,
      })),
      channel,
    });
  } catch (error) {
    console.error("Mock Pusher events error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
