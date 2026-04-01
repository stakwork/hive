import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";

/**
 * Mock endpoint for fetching swarm credentials
 * GET /api/mock/swarm-super-admin/api/super/swarm_credentials?instance_id=<id>
 */
export async function GET(request: NextRequest) {
  // 1. Validate x-super-token header
  const token = request.headers.get("x-super-token");
  if (!token || token !== env.SWARM_SUPERADMIN_API_KEY) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Read instance_id from query params
  const instanceId = new URL(request.url).searchParams.get("instance_id");
  if (!instanceId) {
    return NextResponse.json(
      { success: false, message: "instance_id required" },
      { status: 400 }
    );
  }

  // 3. Return mock credentials
  return NextResponse.json({
    success: true,
    message: "Swarm credentials",
    data: { username: "super", password: "mock-password" },
  });
}
