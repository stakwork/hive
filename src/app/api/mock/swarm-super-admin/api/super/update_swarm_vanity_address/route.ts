import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { mockSwarmState } from "@/lib/mock/swarm-state";

/**
 * Mock endpoint for updating a swarm's vanity address
 * POST /api/mock/swarm-super-admin/api/super/update_swarm_vanity_address
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Validate x-super-token
    const token = request.headers.get("x-super-token");
    if (!token || token !== env.SWARM_SUPERADMIN_API_KEY) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse request
    const body = await request.json();
    const { host, vanity_address } = body;

    if (!host || !vanity_address) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: host and vanity_address" },
        { status: 400 }
      );
    }

    // 3. Update vanity address
    const result = mockSwarmState.updateVanityAddress(host, vanity_address);

    // 4. Return response
    return NextResponse.json(result);
  } catch (error) {
    console.error("Mock swarm update_vanity_address error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
