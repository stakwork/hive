import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockSwarmState } from "@/lib/mock/swarm-state";

/**
 * Mock endpoint for fetching swarm details
 * GET /api/mock/swarm-super-admin/api/super/details?id=mock-swarm-000001
 *
 * Returns 400 status for PENDING swarms to trigger retry logic in fetchSwarmDetails
 * Returns 200 with full details for RUNNING swarms
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Validate x-super-token
    const token = request.headers.get("x-super-token");
    if (!token || token !== config.SWARM_SUPERADMIN_API_KEY) {
      return NextResponse.json({ ok: false, data: { message: "Unauthorized" }, status: 401 }, { status: 401 });
    }

    // 2. Get swarm ID from query params
    const { searchParams } = new URL(request.url);
    const swarmId = searchParams.get("id");

    if (!swarmId) {
      return NextResponse.json(
        {
          ok: false,
          data: { message: "Missing required parameter: id" },
          status: 400,
        },
        { status: 400 }
      );
    }

    // 3. Get swarm details (auto-creates if not exists)
    const swarm = mockSwarmState.getSwarmDetails(swarmId);

    // 4. Return 400 if still pending (to trigger retry logic in fetchSwarmDetails)
    if (swarm.status === "PENDING") {
      return NextResponse.json(
        {
          ok: false,
          data: { message: "Swarm is still starting up" },
          status: 400,
        },
        { status: 400 }
      );
    }

    // 5. Return swarm details
    return NextResponse.json({
      ok: true,
      data: {
        swarm_id: swarm.swarm_id,
        address: swarm.address,
        x_api_key: swarm.x_api_key,
        ec2_id: swarm.ec2_id,
        instance_type: swarm.instance_type,
        status: swarm.status,
        createdAt: swarm.createdAt.toISOString(),
        updatedAt: swarm.updatedAt.toISOString(),
      },
      status: 200,
    });
  } catch (error) {
    console.error("Mock swarm details error:", error);
    return NextResponse.json(
      {
        ok: false,
        data: { message: "Internal server error" },
        status: 500,
      },
      { status: 500 }
    );
  }
}