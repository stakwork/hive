import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Progress Endpoint
 *
 * Simulates: GET https://{swarm}:3355/progress?request_id=...
 *
 * Returns a completed status with a sample mermaid diagram in the result.
 */
export async function GET(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("request_id");

    console.log(`[StakgraphMock] GET /progress?request_id=${requestId}`);

    return NextResponse.json({
      status: "completed",
      result: {
        content:
          "```mermaid\ngraph TD\n  A[Client] --> B[API Route]\n  B --> C[repoAgent]\n  C --> D[Swarm]\n```",
      },
    });
  } catch (error) {
    console.error("[StakgraphMock] GET /progress error:", error);
    return NextResponse.json({ error: "Failed to get progress" }, { status: 500 });
  }
}
