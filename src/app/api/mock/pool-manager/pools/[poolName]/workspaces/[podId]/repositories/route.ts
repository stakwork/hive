import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager pod repository update endpoint
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/repositories
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
    const { repositories = [], branches = [] } = body;

    const updated = mockPoolState.updatePodRepositories(
      poolName,
      podId,
      repositories,
      branches
    );

    if (!updated) {
      return NextResponse.json({ error: "Pod not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Repositories updated",
      podId,
      repositories,
      branches,
    });
  } catch (error) {
    console.error("Mock Pool Manager update repositories error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
