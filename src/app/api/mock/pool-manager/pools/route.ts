import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager pool endpoints
 * POST /api/mock/pool-manager/pools - Create pool (matches CreatePoolRequest)
 * GET /api/mock/pool-manager/pools - List pools
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Match real API: accepts pool_name, minimum_vms, repo_name, etc.
    const { pool_name, minimum_vms = 5 } = body;

    if (!pool_name) {
      return NextResponse.json(
        { error: "Pool name required" },
        { status: 400 }
      );
    }

    try {
      // Use getOrCreatePool to handle both create and idempotent re-create
      const pool = mockPoolState.getOrCreatePool(pool_name, minimum_vms);

      // Response format matches real Pool Manager API (see types/pool-manager.ts)
      return NextResponse.json({
        message: `Pool '${pool_name}' created successfully`,
        success: true,
        pool: {
          id: pool.name,
          name: pool.name,
          pool_name: pool.name,
          description: "Mock pool",
          owner_id: "mock-owner",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
          minimum_vms: pool.maxPods,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Mock Pool Manager create pool error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const pools = mockPoolState.listPools();
    return NextResponse.json({
      success: true,
      pools: pools.map((pool) => ({
        name: pool.name,
        maxPods: pool.maxPods,
        availablePods: pool.pods.filter((p) => p.usage_status === "available")
          .length,
        totalPods: pool.pods.length,
      })),
    });
  } catch (error) {
    console.error("Mock Pool Manager list pools error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
