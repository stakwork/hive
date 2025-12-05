import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

/**
 * Mock Pusher Connection Endpoint
 * 
 * Creates a new mock connection and returns socket ID.
 * Used by client-side code to establish mock connection.
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
    const connection = mockPusherState.createConnection();

    return NextResponse.json({
      socket_id: connection.socketId,
      connection_id: connection.id,
      activity_timeout: 120,
    });
  } catch (error) {
    console.error("Mock Pusher connection error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to remove a connection
 */
export async function DELETE(request: NextRequest) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoint only available in mock mode" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connection_id");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Missing connection_id" },
        { status: 400 }
      );
    }

    mockPusherState.removeConnection(connectionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mock Pusher disconnect error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
