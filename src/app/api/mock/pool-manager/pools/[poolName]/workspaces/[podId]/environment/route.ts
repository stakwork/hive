import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager pod environment update endpoint
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/environment
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName, podId } = await context.params;
    const body = await request.json();
    const { environment = {} } = body;

    const updated = mockPoolState.updatePodEnvironment(
      poolName,
      podId,
      environment
    );

    if (!updated) {
      return NextResponse.json({ error: "Pod not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Environment variables updated",
      podId,
      environment,
    });
  } catch (error) {
    console.error("Mock Pool Manager update environment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
