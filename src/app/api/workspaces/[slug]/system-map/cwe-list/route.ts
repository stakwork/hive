/**
 * GET /api/workspaces/:slug/system-map/cwe-list?view=CWE-1435
 *      — a curated CWE view (`CWE_LISTS`) from the shared infosec graph's
 *      CWE catalogue: its members, and the usable children of the ones
 *      MITRE says not to map to directly. Backs the Infosec page's CWE lists
 *      tab, which launches the CWE workflows per CWE.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listCweView } from "@/lib/system-map/cwe-catalogue";
import { isCweList } from "@/lib/system-map/cwe-lists";
import type { CweListResponse } from "@/types/system-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const view = request.nextUrl.searchParams.get("view");
    if (!isCweList(view)) return NextResponse.json({ error: "Unknown CWE list" }, { status: 400 });

    const listed = await listCweView(view);
    const body: CweListResponse = listed.ok
      ? { status: "ready", view: listed.view, members: listed.members }
      : { status: "error", error: listed.error };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] cwe-list GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
