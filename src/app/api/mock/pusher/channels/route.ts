import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

/**
 * Mock Pusher Channels Debug Endpoint
 * 
 * Provides debugging utilities for mock Pusher state.
 * GET - List all channels
 * DELETE - Reset all state
 */
export async function GET(request: NextRequest) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoint only available in mock mode" },
      { status: 403 }
    );
  }

  try {
    const channels = mockPusherState.getAllChannels();
    const connections = mockPusherState.getAllConnections();

    return NextResponse.json({
      channels: channels.map(ch => ({
        name: ch.name,
        subscribers: ch.subscribers.size,
        messages: ch.messageHistory.length,
        createdAt: ch.createdAt,
      })),
      connections: connections.map(conn => ({
        id: conn.id,
        socketId: conn.socketId,
        channelCount: conn.channels.size,
        channels: Array.from(conn.channels),
        createdAt: conn.createdAt,
        lastActivityAt: conn.lastActivityAt,
      })),
      stats: {
        totalChannels: channels.length,
        totalConnections: connections.length,
      },
    });
  } catch (error) {
    console.error("Mock Pusher channels debug error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to reset all mock state
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
    mockPusherState.reset();

    return NextResponse.json({
      success: true,
      message: "Mock Pusher state reset",
    });
  } catch (error) {
    console.error("Mock Pusher reset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
