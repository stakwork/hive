import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

/**
 * Mock Pusher Trigger Endpoint
 * 
 * Simulates pusherServer.trigger() - queues events in mock state manager.
 * Used by server-side code to broadcast events.
 */
export async function POST(request: NextRequest) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoint only available in mock mode" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { channel, channels, event, data } = body;

    // Support both single channel and multiple channels
    const channelList = channels || (channel ? [channel] : null);

    if (!channelList || !event) {
      return NextResponse.json(
        { error: "Missing channel(s) or event" },
        { status: 400 }
      );
    }

    // Trigger event on all specified channels
    const triggeredEvents = channelList.map((ch: string) => {
      const pusherEvent = mockPusherState.trigger(ch, event, data);
      return {
        channel: ch,
        event,
        eventId: pusherEvent.id,
        timestamp: pusherEvent.timestamp,
      };
    });

    return NextResponse.json({
      success: true,
      events: triggeredEvents,
    });
  } catch (error) {
    console.error("Mock Pusher trigger error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
