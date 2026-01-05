import { NextRequest, NextResponse } from "next/server";
import { stakgraphState } from "@/lib/mock/stakgraph-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Ingest Async Endpoint
 * 
 * Simulates: POST https://{swarm}:7799/ingest_async
 * 
 * Starts an asynchronous code ingestion process.
 * Returns immediately with a request_id that can be polled for status.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo_url, username, pat, callback_url, use_lsp = false, _realtime = true } = body;

    // Validate required fields
    if (!repo_url) {
      return NextResponse.json(
        { error: "repo_url is required" },
        { status: 400 }
      );
    }

    if (!username || !pat) {
      return NextResponse.json(
        { error: "username and pat are required for authentication" },
        { status: 400 }
      );
    }

    // Validate authorization header
    const authHeader = request.headers.get("authorization");
    const apiToken = request.headers.get("x-api-token");
    
    if (!authHeader && !apiToken) {
      return NextResponse.json(
        { error: "Missing authorization" },
        { status: 401 }
      );
    }

    // Create the ingestion request
    const requestId = stakgraphState.createIngestRequest(
      repo_url,
      username,
      callback_url,
      use_lsp
    );

    console.log(`[StakgraphMock] Started ingest for ${repo_url} (request: ${requestId})`);

    return NextResponse.json({
      request_id: requestId,
      status: "pending",
      message: "Ingestion started",
    });

  } catch (error) {
    console.error("[StakgraphMock] Ingest error:", error);
    return NextResponse.json(
      { error: "Failed to start ingestion" },
      { status: 500 }
    );
  }
}
