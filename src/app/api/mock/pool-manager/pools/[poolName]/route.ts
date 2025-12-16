import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager specific pool endpoints
 * GET /api/mock/pool-manager/pools/[poolName] - Get pool status (matches real API format)
 * PATCH /api/mock/pool-manager/pools/[poolName] - Update pool
 * DELETE /api/mock/pool-manager/pools/[poolName] - Delete pool
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
  }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName } = await context.params;
    // Auto-create pool if it doesn't exist - makes mock work with any workspace config
    const pool = mockPoolState.getOrCreatePool(poolName);

    const runningPods = pool.pods.filter((p) => p.state === "running");
    const usedPods = pool.pods.filter((p) => p.usage_status === "in_use");
    const unusedPods = pool.pods.filter(
      (p) => p.usage_status === "available" && p.state === "running"
    );

    return NextResponse.json({
      pool_name: pool.name,
      status: {
        running_vms: runningPods.length,
        pending_vms: 0,
        failed_vms: 0,
        used_vms: usedPods.length,
        unused_vms: unusedPods.length,
        last_check: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Mock Pool Manager get pool error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName } = await context.params;
    const body = await request.json();

    try {
      const pool = mockPoolState.updatePool(poolName, body);
      return NextResponse.json({
        success: true,
        pool: {
          name: pool.name,
          maxPods: pool.maxPods,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("Mock Pool Manager update pool error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName } = await context.params;

    try {
      mockPoolState.deletePool(poolName);
      return NextResponse.json({
        success: true,
        message: `Pool ${poolName} deleted`,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("Mock Pool Manager delete pool error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
