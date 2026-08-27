import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for Cypher graph queries.
 *
 * Thin wrapper over `./fixture` — all result-building lives in
 * `buildMockGraphQueryResult` so the shared
 * `runWorkspaceGraphQuery` service can reuse the exact same fixture under
 * USE_MOCKS without an HTTP hop.
 */
import { buildMockGraphQueryResult } from "./fixture";

export async function POST(request: Request) {
  let query = "";
  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query : "";
  } catch {
    // No body or invalid JSON — treat as empty query (returns code-graph fixture)
  }

  return NextResponse.json(buildMockGraphQueryResult({ query }), {
    status: 200,
  });
}
