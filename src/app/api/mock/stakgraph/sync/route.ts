import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Sync Endpoint (Blocking)
 * 
 * Simulates: POST https://{swarm}:7799/sync
 * 
 * Blocking sync operation - returns after completion.
 * For simplicity, mock returns immediately as "completed".
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo_url } = body;

    if (!repo_url) {
      return NextResponse.json(
        { error: "repo_url is required" },
        { status: 400 }
      );
    }

    // Auth validation
    const authHeader = request.headers.get("authorization");
    const apiToken = request.headers.get("x-api-token");
    
    if (!authHeader && !apiToken) {
      return NextResponse.json(
        { error: "Missing authorization" },
        { status: 401 }
      );
    }

    // Simulate a quick blocking sync
    console.log(`[StakgraphMock] Blocking sync for ${repo_url}`);
    
    // In a real scenario, this would block until complete
    // For mock, return immediately
    return NextResponse.json({
      status: "completed",
      message: "Sync completed successfully",
      repo_url,
    });

  } catch {
    return NextResponse.json(
      { error: "Failed to sync" },
      { status: 500 }
    );
  }
}
