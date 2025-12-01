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
    const requestUrl = new URL(request.url);
    const { searchParams } = requestUrl;
    const workspaceId = searchParams.get("workspaceId") || "unknown-workspace";

    // Construct absolute URL for mock browser frame
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    const mockBrowserFrameUrl = `${baseUrl}/api/mock/browser-frame`;

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
    // Use absolute URL for mock browser frame so check-url can fetch it
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
        portMappings: {
          "3000": mockBrowserFrameUrl,
          "3001": mockBrowserFrameUrl,
          "5173": mockBrowserFrameUrl,
          "8080": mockBrowserFrameUrl,
        },
        primaryRepo: pod.repositories[0] || "",
        repoName: pod.repositories[0]?.split("/").pop() || "",
        repositories: pod.repositories,
        state: pod.state,
        subdomain: pod.id,
        url: mockBrowserFrameUrl,
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
