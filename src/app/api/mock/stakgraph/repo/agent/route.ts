import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Repo Agent Endpoint
 *
 * Simulates: POST https://{swarm}:3355/repo/agent
 *
 * Accepts a prompt (with optional skills) and returns a mock request_id
 * that can be polled via GET /api/mock/stakgraph/progress.
 */
export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    console.log("[StakgraphMock] POST /repo/agent - returning mock request_id");

    return NextResponse.json({ request_id: "mock-diagram-req-001" });
  } catch (error) {
    console.error("[StakgraphMock] POST /repo/agent error:", error);
    return NextResponse.json({ error: "Failed to process repo agent request" }, { status: 500 });
  }
}
