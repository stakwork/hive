import { NextRequest, NextResponse } from "next/server";
import { stakgraphState } from "@/lib/mock/stakgraph-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Sync Async Endpoint
 * 
 * Simulates: POST https://{swarm}:7799/sync_async
 * 
 * Similar to ingest_async but for syncing existing repositories.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo_url, username, pat: _pat, callback_url, use_lsp = false } = body;

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

    // Create sync request (reuse ingest state machine)
    const requestId = stakgraphState.createIngestRequest(
      repo_url,
      username || 'mock-user',
      callback_url,
      use_lsp
    );

    console.log(`[StakgraphMock] Started sync for ${repo_url} (request: ${requestId})`);

    return NextResponse.json({
      request_id: requestId,
      status: "pending",
      message: "Sync started",
    });

  } catch (error) {
    console.error("[StakgraphMock] Sync error:", error);
    return NextResponse.json(
      { error: "Failed to start sync" },
      { status: 500 }
    );
  }
}
