import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager workspaces list endpoint
 * GET /api/mock/pool-manager/pools/[poolName]/workspaces - List all workspaces in pool
 * Response format matches PoolWorkspacesResponse type
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { poolName } = await context.params;
    // Auto-create pool if it doesn't exist - makes mock work with any workspace config
    const pool = mockPoolState.getOrCreatePool(poolName);

    return NextResponse.json({
      pool_name: pool.name,
      workspaces: pool.pods.map((pod) => ({
        id: pod.id,
        subdomain: pod.id,
        state: pod.state,
        internal_state: pod.state,
        usage_status: pod.usage_status === "in_use" ? "used" : "unused",
        user_info: pod.userInfo || pod.workspaceId || null,
        resource_usage: {
          available: true,
          requests: {
            cpu: "500m",
            memory: "1Gi",
          },
          usage: {
            cpu: "100m",
            memory: "256Mi",
          },
        },
        marked_at: null,
        url: pod.url,
        created: pod.claimedAt?.toISOString() || new Date().toISOString(),
        repoName: pod.repositories[0] || null,
        primaryRepo: pod.repositories[0] || null,
        repositories: pod.repositories,
        branches: pod.branches,
      })),
    });
  } catch (error) {
    console.error("Mock Pool Manager list workspaces error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
