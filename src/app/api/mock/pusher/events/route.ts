import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";
import { logger } from "@/lib/logger";

/**
 * GET /api/mock/pusher/events?channel={channel}&lastEventId={id}
 * 
 * Mock endpoint for client-side Pusher event polling.
 * Returns new events for a channel since the last seen event.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const channel = searchParams.get("channel");
    const lastEventId = searchParams.get("lastEventId") || undefined;

    if (!channel) {
      return NextResponse.json(
        { error: "Missing required parameter: channel" },
        { status: 400 }
      );
    }

    // Get events since lastEventId
    const events = mockPusherState.getEvents(channel, lastEventId);

    logger.debug("[MockPusher API] Events polled", "MockPusherAPI", {
      channel,
      lastEventId,
      eventCount: events.length,
    });

    return NextResponse.json({
      channel,
      events,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error("[MockPusher API] Events polling error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to retrieve events" },
      { status: 500 }
    );
  }
}
