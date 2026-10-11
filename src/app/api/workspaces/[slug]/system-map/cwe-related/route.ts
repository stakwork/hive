/**
 * GET /api/workspaces/:slug/system-map/cwe-related?refId=<CWE ref_id>
 *      — one CWE's test templates, mitigations, detection methods and
 *      platforms from the shared infosec graph, loaded when its row is opened
 *      on the Infosec page's CWE lists tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { loadCweRelated } from "@/lib/system-map/cwe-catalogue";
import type { CweRelatedResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const refId = request.nextUrl.searchParams.get("refId");
    if (!refId || !REF_ID_RE.test(refId)) return NextResponse.json({ error: "Invalid refId" }, { status: 400 });

    let body: CweRelatedResponse;
    try {
      body = await loadCweRelated(refId);
    } catch (error) {
      body = { status: "error", error: `Infosec graph: ${error instanceof Error ? error.message : String(error)}` };
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] cwe-related GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
