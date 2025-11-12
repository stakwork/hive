import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mock endpoint for Swarm stop_swarm API
 * POST /api/super/stop_swarm - Stop a swarm
 * Note: No authentication required for mock endpoints
 */
export async function POST(request: NextRequest) {
  try {

    const body = await request.json();
    console.log("[Mock Swarm] Stopping swarm:", body.id || body.swarm_id);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 300));

    const mockResponse = {
      id: body.id || body.swarm_id,
      status: "stopping",
      message: "Swarm shutdown initiated",
      stopped_at: new Date().toISOString(),
      estimated_shutdown_time: "2-3 minutes",
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Swarm stop_swarm:", error);
    return NextResponse.json({ error: "Failed to stop swarm" }, { status: 500 });
  }
}