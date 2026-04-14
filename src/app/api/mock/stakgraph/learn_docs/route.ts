import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Learn Docs Endpoint
 *
 * Simulates: POST https://{swarm}:3355/learn_docs
 *
 * Accepts { repo_url } in body and returns a mock success response.
 */
export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    // parse body to accept repo_url (no validation needed for mock)
    await request.json().catch(() => null);

    console.log("[StakgraphMock] POST /learn_docs - returning mock success response");

    return NextResponse.json({
      message: "Documentation learned",
      summaries: {},
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  } catch (error) {
    console.error("[StakgraphMock] POST /learn_docs error:", error);
    return NextResponse.json({ error: "Failed to process learn_docs request" }, { status: 500 });
  }
}
