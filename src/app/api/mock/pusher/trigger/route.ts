import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";
import { logger } from "@/lib/logger";

/**
 * POST /api/mock/pusher/trigger
 * 
 * Mock endpoint for Pusher server-side trigger operations.
 * Stores events in mock state for client polling.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channels, event, data } = body;

    if (!channels || !event) {
      return NextResponse.json(
        { error: "Missing required fields: channels, event" },
        { status: 400 }
      );
    }

    // Store event in mock state
    mockPusherState.trigger(channels, event, data);

    logger.debug("[MockPusher API] Event triggered", "MockPusherAPI", {
      channels: Array.isArray(channels) ? channels : [channels],
      event,
    });

    // Match real Pusher API response format
    return NextResponse.json({
      success: true,
      channels: Array.isArray(channels) ? channels : [channels],
    });
  } catch (error) {
    logger.error("[MockPusher API] Trigger error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to trigger event" },
      { status: 500 }
    );
  }
}
