import { kgGetOntology } from "@/lib/ai/kg-adapter";
import { resolveJarvisAccess } from "@/lib/helpers/graph-jarvis";
import { NextRequest, NextResponse } from "next/server";
import type { GraphNodeTypesResponse } from "@/types/graph-node";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/node-types
 *
 * The workspace's node-type ontology, for the search filter's options. Backed
 * by `kgGetOntology`, which merges Jarvis `GET /graph/labels` (the real Neo4j
 * labels, so the strings match what the `type` filter expects) with
 * `GET /v2/schema` (domain + description). Both are best-effort — a partial
 * ontology is better than an empty filter.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const access = await resolveJarvisAccess(slug);
    if (access instanceof NextResponse) return access;

    if (process.env.USE_MOCKS === "true") {
      const { getMockNodeTypes } = await import("@/app/api/mock/graph/node-types/fixtures");
      return NextResponse.json(getMockNodeTypes(), { status: 200 });
    }

    const ontology = await kgGetOntology(access.jarvisUrl, access.apiKey);

    const payload: GraphNodeTypesResponse = {
      node_types: ontology.node_types.map((t) => ({
        type: t.type,
        domain: t.domain,
        description: t.description,
      })),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
