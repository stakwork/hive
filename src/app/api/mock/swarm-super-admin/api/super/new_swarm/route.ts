import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockSwarmState } from "@/lib/mock/swarm-state";

/**
 * Mock endpoint for creating a new swarm
 * POST /api/mock/swarm-super-admin/api/super/new_swarm
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Validate x-super-token header
    const token = request.headers.get("x-super-token");
    if (!token || token !== config.SWARM_SUPERADMIN_API_KEY) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const body = await request.json();
    const { instance_type, password } = body;

    if (!instance_type) {
      return NextResponse.json(
        { success: false, message: "Missing required field: instance_type" },
        { status: 400 }
      );
    }

    // 3. Create swarm using state manager
    const result = mockSwarmState.createSwarm({
      instance_type,
      password,
    });

    // 4. Return response matching CreateSwarmResponse interface
    return NextResponse.json({
      success: true,
      message: "Swarm created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Mock swarm creation error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}