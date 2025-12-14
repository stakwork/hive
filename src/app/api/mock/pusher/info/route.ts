/**
 * Pusher Mock Info Endpoint
 * 
 * Provides diagnostic information about the Pusher mock state.
 * Allows inspection and reset of mock state for development and testing.
 * 
 * GET /api/mock/pusher/info - Get current state
 * POST /api/mock/pusher/info - Reset state
 */

import { NextRequest, NextResponse } from "next/server";
import { pusherMockState } from "@/lib/mock/pusher-state";
import { optionalEnvVars } from "@/config/env";

/**
 * GET - Retrieve current mock state
 */
export async function GET(request: NextRequest) {
  // Only available in mock mode
  if (!optionalEnvVars.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are not enabled. Set USE_MOCKS=true to enable." },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel");
  const limit = parseInt(searchParams.get("limit") || "100");

  try {
    const stats = pusherMockState.getStats();
    const subscriptions = pusherMockState.getSubscriptions();
    const eventHistory = pusherMockState.getEventHistory(channel || undefined, limit);

    return NextResponse.json({
      stats,
      subscriptions,
      eventHistory,
      useMocks: true,
    });
  } catch (error) {
    console.error("Error retrieving Pusher mock state:", error);
    return NextResponse.json(
      { error: "Failed to retrieve mock state" },
      { status: 500 }
    );
  }
}

/**
 * POST - Reset mock state
 */
export async function POST(request: NextRequest) {
  // Only available in mock mode
  if (!optionalEnvVars.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints are not enabled. Set USE_MOCKS=true to enable." },
      { status: 404 }
    );
  }

  try {
    pusherMockState.reset();

    return NextResponse.json({
      message: "Pusher mock state reset successfully",
      stats: pusherMockState.getStats(),
    });
  } catch (error) {
    console.error("Error resetting Pusher mock state:", error);
    return NextResponse.json(
      { error: "Failed to reset mock state" },
      { status: 500 }
    );
  }
}
