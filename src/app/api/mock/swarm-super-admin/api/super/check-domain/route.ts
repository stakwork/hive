import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockSwarmState } from "@/lib/mock/swarm-state";

/**
 * Mock endpoint for checking domain availability
 * GET /api/mock/swarm-super-admin/api/super/check-domain?domain=myswarm
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Validate x-super-token
    const token = request.headers.get("x-super-token");
    if (!token || token !== config.SWARM_SUPERADMIN_API_KEY) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    // 2. Get domain from query params
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain");

    if (!domain) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: domain" },
        { status: 400 }
      );
    }

    // 3. Check domain availability
    const result = mockSwarmState.checkDomain(domain);

    // 4. Return response
    return NextResponse.json({
      success: true,
      message: "Domain check completed",
      data: result,
    });
  } catch (error) {
    console.error("Mock domain check error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}