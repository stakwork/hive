import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

/**
 * Mock Pusher Subscribe Endpoint
 * 
 * Subscribes a connection to a channel.
 * Tracks subscriptions in the mock state manager.
 */
export async function POST(
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
    const body = await request.json();
    const { connection_id } = body;

    if (!connection_id) {
      return NextResponse.json(
        { error: "Missing connection_id" },
        { status: 400 }
      );
    }

    // Subscribe connection to channel
    mockPusherState.subscribe(connection_id, channel);

    return NextResponse.json({
      success: true,
      channel,
      subscription_count: mockPusherState.getSubscriberCount(channel),
    });
  } catch (error) {
    console.error("Mock Pusher subscribe error:", error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : "Internal server error" 
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to unsubscribe from a channel
 */
export async function DELETE(
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
    const connectionId = searchParams.get("connection_id");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connection_id" },
        { status: 400 }
      );
    }

    mockPusherState.unsubscribe(connectionId, channel);

    return NextResponse.json({
      success: true,
      channel,
    });
  } catch (error) {
    console.error("Mock Pusher unsubscribe error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
