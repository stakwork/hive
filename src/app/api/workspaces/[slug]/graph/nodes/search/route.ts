import { kgSearch } from "@/lib/ai/kg-adapter";
import { resolveJarvisAccess } from "@/lib/helpers/graph-jarvis";
import { NextRequest, NextResponse } from "next/server";
import type { GraphSearchResponse } from "@/types/graph-node";

export const runtime = "nodejs";

/** Keep one page of results small enough to scan; the UI paginates by refining. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

/**
 * GET /api/workspaces/[slug]/graph/nodes/search
 *
 * Hybrid keyword + semantic search over the workspace graph, via Jarvis
 * `GET /v2/nodes?q=&type=&limit=`. `types` is a comma-separated node-type
 * filter (the UI defaults it to `Concept`); omit it to search every type.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const searchParams = request.nextUrl.searchParams;

    const query = searchParams.get("q")?.trim();
    if (!query) {
      return NextResponse.json({ success: false, message: "q is required" }, { status: 400 });
    }

    // Drop blank entries so a trailing comma doesn't become an empty type filter.
    const types = (searchParams.get("types") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(",");

    const parsedLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const access = await resolveJarvisAccess(slug);
    if (access instanceof NextResponse) return access;

    if (process.env.USE_MOCKS === "true") {
      const { getMockGraphSearch } = await import("@/app/api/mock/graph/nodes-search/fixtures");
      return NextResponse.json(getMockGraphSearch(query, types), { status: 200 });
    }

    // kgSearch swallows transport errors and returns [] — an empty result and a
    // failed lookup are indistinguishable here, which is why the UI reports
    // "no matches" rather than claiming the graph is empty.
    const hits = await kgSearch(access.jarvisUrl, access.apiKey, query, {
      limit,
      ...(types ? { type: types } : {}),
    });

    const payload: GraphSearchResponse = {
      results: hits.map((h) => ({
        ref_id: h.ref_id,
        node_type: h.node_type,
        name: h.name,
        description: h.description,
      })),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
