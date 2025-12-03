import { NextRequest, NextResponse } from "next/server";
import { stakgraphState } from "@/lib/mock/stakgraph-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Status Endpoint
 * 
 * Simulates: GET https://{swarm}:7799/status/{request_id}
 * 
 * Returns the current status of an ingestion/sync request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;

    // Auth validation
    const authHeader = request.headers.get("authorization");
    const apiToken = request.headers.get("x-api-token");
    
    if (!authHeader && !apiToken) {
      return NextResponse.json(
        { error: "Missing authorization" },
        { status: 401 }
      );
    }

    // Get request status (auto-creates if missing for resilience)
    const ingestRequest = stakgraphState.getRequestStatus(requestId);

    if (!ingestRequest) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request_id: ingestRequest.requestId,
      status: ingestRequest.status.toLowerCase(),
      progress: ingestRequest.progress,
      repo_url: ingestRequest.repoUrl,
      created_at: new Date(ingestRequest.createdAt).toISOString(),
      ...(ingestRequest.completedAt && {
        completed_at: new Date(ingestRequest.completedAt).toISOString(),
      }),
    });

  } catch (error) {
    console.error("[StakgraphMock] Status check error:", error);
    return NextResponse.json(
      { error: "Failed to get status" },
      { status: 500 }
    );
  }
}
