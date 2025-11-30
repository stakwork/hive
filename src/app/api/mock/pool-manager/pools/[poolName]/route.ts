import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../state";

/**
 * Mock Pool Manager - Delete Pool
 * DELETE /api/mock/pool-manager/pools/[poolName]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = poolManagerState.getUserByToken(token);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const deleted = poolManagerState.deletePool(poolName);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Pool not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Pool '${poolName}' deleted successfully`,
    });
  } catch (error) {
    console.error("Mock Pool Manager delete pool error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete pool" },
      { status: 500 }
    );
  }
}

/**
 * Mock Pool Manager - Update Pool Env Vars
 * PUT /api/mock/pool-manager/pools/[poolName]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const pool = poolManagerState.getPool(poolName);
    if (!pool) {
      return NextResponse.json(
        { success: false, error: "Pool not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { env_vars } = body;

    if (env_vars) {
      pool.env_vars = env_vars;
    }

    return NextResponse.json({
      success: true,
      message: `Pool '${poolName}' updated successfully`,
      pool,
    });
  } catch (error) {
    console.error("Mock Pool Manager update pool error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update pool" },
      { status: 500 }
    );
  }
}