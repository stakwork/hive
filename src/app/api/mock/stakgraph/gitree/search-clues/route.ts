import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Gitree Search Clues Endpoint
 *
 * POST { query } — Returns mock semantic search results with relevance scores
 */
export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    const body = await request.json();
    const { query } = body;

    console.log(`[StakgraphMock] POST /gitree/search-clues - query length=${query?.length ?? 0}`);

    return NextResponse.json({
      results: [
        {
          clue: {
            id: "stakwork/hive/auth",
            content: "OAuth flow handles token exchange and session management.",
          },
          score: 0.85,
          relevanceBreakdown: {
            vector: 0.85,
            content: 0.7,
            centrality: 0.5,
          },
        },
        {
          clue: {
            id: "stakwork/hive/workspace",
            content: "Workspace access control with JWT verification.",
          },
          score: 0.78,
          relevanceBreakdown: {
            vector: 0.78,
            content: 0.65,
            centrality: 0.45,
          },
        },
      ],
    });
  } catch (error) {
    console.error("[StakgraphMock] POST /gitree/search-clues error:", error);
    return NextResponse.json({ error: "Failed to search clues" }, { status: 500 });
  }
}
