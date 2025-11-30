import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager get workspace endpoint
 * GET /api/mock/pool-manager/pools/[poolName]/workspace
 * Returns an available pod from the pool (claims it)
 * Response format matches PodWorkspace interface
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
  }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName } = await context.params;
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") || "unknown-workspace";

    // Auto-create pool if it doesn't exist - makes mock work with any workspace config
    mockPoolState.getOrCreatePool(poolName);

    const pod = mockPoolState.claimPod(poolName, workspaceId);
    if (!pod) {
      return NextResponse.json(
        { error: "No available pods in pool" },
        { status: 404 }
      );
    }

    // Response format matches PodWorkspace interface expected by claimPodAndGetFrontend
    return NextResponse.json({
      workspace: {
        id: pod.id,
        branches: pod.branches,
        created: new Date().toISOString(),
        customImage: false,
        flagged_for_recreation: pod.flagged_for_recreation,
        fqdn: `${pod.id}.mock-pool.local`,
        image: "mock-image",
        marked_at: "",
        password: pod.password,
        portMappings: pod.portMappings,
        primaryRepo: pod.repositories[0] || "",
        repoName: pod.repositories[0]?.split("/").pop() || "",
        repositories: pod.repositories,
        state: pod.state,
        subdomain: pod.id,
        url: pod.url,
        usage_status: pod.usage_status,
        useDevContainer: false,
      },
    });
  } catch (error) {
    console.error("Mock Pool Manager get workspace error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
