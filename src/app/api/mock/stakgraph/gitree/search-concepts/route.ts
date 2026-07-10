import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mockSearchConcepts = [
  {
    id: "stakwork/hive/auth",
    name: "Authentication",
    description: "Handles JWT and OAuth flows for user authentication.",
    score: 0.95,
  },
  {
    id: "stakwork/hive/tasks",
    name: "Task Management",
    description: "Core task CRUD with dual status system (user vs workflow).",
    score: 0.87,
  },
  {
    id: "stakwork/hive/janitors",
    name: "Janitor Workflows",
    description: "Automated code quality analysis and PR monitoring janitors.",
    score: 0.72,
  },
];

/**
 * Mock Stakgraph Gitree Search-Concepts Endpoint
 *
 * POST — Returns a relevance-ranked concept list matching the real search-concepts API contract:
 *        { query, repo, total, concepts[] }
 *        Each concept has id, name, description, and score.
 *
 * Gated on x-api-token header (401 when missing), mirroring the GET /gitree/concepts mock.
 */
export async function POST(request: NextRequest) {
  try {
    const apiToken = request.headers.get("x-api-token");

    if (!apiToken) {
      return NextResponse.json({ error: "Missing x-api-token header" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { query = "", repo, limit } = body as {
      query?: string;
      repo?: string;
      limit?: number;
    };

    let concepts = mockSearchConcepts;

    // Apply repo filter if provided
    if (repo) {
      const target = repo.toLowerCase().replace(/^\/+|\/+$/g, "");
      concepts = concepts.filter((c) => c.id.toLowerCase().startsWith(target));
    }

    // Apply limit if provided
    if (limit && limit > 0) {
      concepts = concepts.slice(0, limit);
    }

    console.log(
      `[StakgraphMock] POST /gitree/search-concepts - query="${query}" repo="${repo ?? ""}" returning ${concepts.length} concepts`,
    );

    return NextResponse.json({
      query,
      repo: repo ?? null,
      total: concepts.length,
      concepts,
    });
  } catch (error) {
    console.error("[StakgraphMock] POST /gitree/search-concepts error:", error);
    return NextResponse.json({ error: "Failed to search concepts" }, { status: 500 });
  }
}
