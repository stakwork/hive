import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../state";

/**
 * Mock Pool Manager - Create Pool
 * POST /api/mock/pool-manager/pools
 */
export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const {
      pool_name,
      minimum_vms,
      repo_name,
      branch_name,
      github_username,
      env_vars,
    } = body;

    if (!pool_name) {
      return NextResponse.json(
        { success: false, error: "pool_name is required" },
        { status: 400 }
      );
    }

    const pool = poolManagerState.createPool({
      pool_name,
      minimum_vms: minimum_vms || 1,
      repo_name: repo_name || "https://github.com/default/repo",
      branch_name: branch_name || "main",
      github_username: github_username || "default",
      env_vars: env_vars || [],
      owner: user.username,
    });

    return NextResponse.json({
      success: true,
      message: `Pool '${pool_name}' created successfully`,
      pool: {
        name: pool.name,
        owner: pool.owner,
        minimum_vms: pool.minimum_vms,
        repo_name: pool.repo_name,
        branch_name: pool.branch_name,
        created_at: pool.created_at,
        workspaces_count: pool.workspaces.length,
      },
    });
  } catch (error) {
    console.error("Mock Pool Manager create pool error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create pool" },
      { status: 500 }
    );
  }
}