/**
 * GET /api/workspaces/:slug/system-map/cwe-search?q=CWE-79 | q=cross-site
 *      — any CWE in the shared infosec graph's catalogue, by id or by name
 *      (`searchCwes`). Backs the CWE lists tab's catalogue search.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { searchCwes } from "@/lib/system-map/cwe-catalogue";
import type { CweSearchResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY = 200;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (!q || q.length > MAX_QUERY) {
      return NextResponse.json({ error: `q must be 1–${MAX_QUERY} characters` }, { status: 400 });
    }

    const found = await searchCwes(q);
    const body: CweSearchResponse = found.ok
      ? { status: "ready", results: found.results }
      : { status: "error", error: found.error };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] cwe-search GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
