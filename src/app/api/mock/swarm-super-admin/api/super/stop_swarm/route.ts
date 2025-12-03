import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockSwarmState } from "@/lib/mock/swarm-state";

/**
 * Mock endpoint for stopping a swarm
 * POST /api/mock/swarm-super-admin/api/super/stop_swarm
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Validate x-super-token
    const token = request.headers.get("x-super-token");
    if (!token || token !== config.SWARM_SUPERADMIN_API_KEY) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse request
    const body = await request.json();
    const { instance_id } = body;

    if (!instance_id) {
      return NextResponse.json(
        { success: false, message: "Missing required field: instance_id" },
        { status: 400 }
      );
    }

    // 3. Stop swarm
    const result = mockSwarmState.stopSwarm(instance_id);

    // 4. Return response
    return NextResponse.json(result);
  } catch (error) {
    console.error("Mock swarm stop error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}