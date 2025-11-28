import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../state";

/**
 * POST /api/mock/pool-manager/pools
 * Create a new pool in the mock Pool Manager
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields = [
      "pool_name",
      "minimum_vms",
      "repo_name",
      "branch_name",
      "github_pat",
      "github_username",
      "env_vars",
      "container_files",
    ];

    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Check if pool already exists
    const existingPool = poolManagerState.getPool(body.pool_name);
    if (existingPool) {
      return NextResponse.json(
        { error: `Pool with name '${body.pool_name}' already exists` },
        { status: 409 }
      );
    }

    // Create the pool
    const pool = poolManagerState.createPool(body);

    // Return response matching real API format
    return NextResponse.json(
      {
        id: pool.id,
        name: pool.name,
        description: pool.description,
        owner_id: pool.owner_id,
        created_at: pool.created_at,
        updated_at: pool.updated_at,
        status: pool.status,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating mock pool:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
