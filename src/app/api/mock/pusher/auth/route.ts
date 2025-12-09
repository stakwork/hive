import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";

/**
 * Mock Pusher Auth Endpoint
 * 
 * Handles channel authentication for private and presence channels.
 * In mock mode, always authorizes subscriptions.
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
    const { socket_id, channel_name } = body;

    if (!socket_id || !channel_name) {
      return NextResponse.json(
        { error: "Missing socket_id or channel_name" },
        { status: 400 }
      );
    }

    // In mock mode, always authorize
    const auth = `mock-auth-${socket_id}-${channel_name}`;
    
    // For presence channels, include channel data
    const channelData = channel_name.startsWith("presence-")
      ? JSON.stringify({
          user_id: "mock-user",
          user_info: { name: "Mock User" },
        })
      : undefined;

    return NextResponse.json({
      auth,
      ...(channelData && { channel_data: channelData }),
    });
  } catch (error) {
    console.error("Mock Pusher auth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
