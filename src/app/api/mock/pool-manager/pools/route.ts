import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../state";

/**
 * POST /api/mock/pool-manager/pools
 * Mock endpoint to create a new pool
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, apiKey } = body;

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error: "Pool name is required",
        },
        { status: 400 }
      );
    }

    console.log(`🎭 [Mock Pool Manager] Creating pool: ${name}`);

    const pool = poolManagerState.getOrCreatePool(name, apiKey || "mock-api-key");

    return NextResponse.json(
      {
        success: true,
        pool: {
          id: pool.id,
          name: pool.name,
          created_at: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error creating pool:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create pool",
      },
      { status: 500 }
    );
  }
}