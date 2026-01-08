import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";
import { logger } from "@/lib/logger";

/**
 * POST /api/mock/pusher/reset
 * 
 * Mock endpoint for resetting Pusher state.
 * Used in test isolation and cleanup.
 */
export async function POST(req: NextRequest) {
  try {
    const stats = mockPusherState.getStats();
    mockPusherState.reset();

    logger.debug("[MockPusher API] State reset", "MockPusherAPI", {
      previousStats: stats,
    });

    return NextResponse.json({
      success: true,
      message: "Mock Pusher state reset successfully",
      clearedStats: stats,
    });
  } catch (error) {
    logger.error("[MockPusher API] Reset error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to reset mock state" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mock/pusher/reset
 * 
 * Get current mock Pusher statistics without resetting.
 */
export async function GET(req: NextRequest) {
  try {
    const stats = mockPusherState.getStats();

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error) {
    logger.error("[MockPusher API] Stats retrieval error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to retrieve stats" },
      { status: 500 }
    );
  }
}
