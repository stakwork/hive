import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../state";

/**
 * GET /api/mock/pool-manager/pools/[name]
 * Get pool status and configuration (used by getPoolStatus)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params;

    if (!name) {
      return NextResponse.json(
        { error: "Pool name is required" },
        { status: 400 }
      );
    }

    // Get the pool
    const pool = poolManagerState.getPool(name);

    if (!pool) {
      return NextResponse.json(
        { error: `Pool '${name}' not found` },
        { status: 404 }
      );
    }

    // Return response matching real API format with status metrics
    return NextResponse.json({
      id: pool.id,
      name: pool.name,
      description: pool.description,
      owner_id: pool.owner_id,
      created_at: pool.created_at,
      updated_at: pool.updated_at,
      status: {
        running_vms: pool.metrics.running_vms,
        pending_vms: pool.metrics.pending_vms,
        failed_vms: pool.metrics.failed_vms,
        used_vms: pool.metrics.used_vms,
        unused_vms: pool.metrics.unused_vms,
        last_check: pool.metrics.last_check,
      },
      config: {
        env_vars: pool.config.env_vars,
      },
    });
  } catch (error) {
    console.error("Error fetching mock pool:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mock/pool-manager/pools/[name]
 * Update pool environment variables and configuration (used by updatePoolData)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params;

    if (!name) {
      return NextResponse.json(
        { error: "Pool name is required" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Check if pool exists
    const pool = poolManagerState.getPool(name);
    if (!pool) {
      return NextResponse.json(
        { error: `Pool '${name}' not found` },
        { status: 404 }
      );
    }

    // Update pool data
    const updated = poolManagerState.updatePoolEnvVars(
      name,
      body.env_vars || [],
      body.poolCpu,
      body.poolMemory,
      body.github_pat,
      body.github_username
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update pool" },
        { status: 500 }
      );
    }

    // Return success response (real API doesn't return data)
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating mock pool:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mock/pool-manager/pools/[name]
 * Delete a pool from the mock Pool Manager
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params;

    if (!name) {
      return NextResponse.json(
        { error: "Pool name is required" },
        { status: 400 }
      );
    }

    // Delete the pool
    const deletedPool = poolManagerState.deletePool(name);

    if (!deletedPool) {
      return NextResponse.json(
        { error: `Pool '${name}' not found` },
        { status: 404 }
      );
    }

    // Return response matching real API format
    return NextResponse.json({
      id: deletedPool.id,
      name: deletedPool.name,
      description: deletedPool.description,
      owner_id: deletedPool.owner_id,
      created_at: deletedPool.created_at,
      updated_at: deletedPool.updated_at,
      status: deletedPool.status,
    });
  } catch (error) {
    console.error("Error deleting mock pool:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
