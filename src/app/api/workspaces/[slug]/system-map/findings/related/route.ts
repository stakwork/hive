/**
 * GET /api/workspaces/:slug/system-map/findings/related?refId=<finding ref_id>
 *      — the finding's neighbours in every namespace, read through boltwall
 *      (`GET /v2/nodes/:ref_id?expand=edges`), and for a finding about a package
 *      its way in from the components (`GET /v2/nodes/:ref_id/ancestors`).
 *      Backs a Findings tab row's detail and the Map's finding panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { isFindingRefId, loadFindingPaths, loadFindingRelated } from "@/lib/system-map/findings";
import type { SystemMapFindingRelatedResponse } from "@/types/system-map";

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

    const refId = request.nextUrl.searchParams.get("refId") ?? "";
    if (!isFindingRefId(refId)) return NextResponse.json({ error: "Invalid refId" }, { status: 400 });

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({
        status: "error",
        error: "Workspace swarm is not configured",
      } satisfies SystemMapFindingRelatedResponse);
    }

    const loaded = await loadFindingRelated(jarvisConfig, refId);
    if (!loaded.ok)
      return NextResponse.json({ status: "error", error: loaded.error } satisfies SystemMapFindingRelatedResponse);

    const { paths, errors } = await loadFindingPaths(jarvisConfig, loaded.related);
    if (errors.length) console.warn(`[SystemMap] finding ${refId} package paths:`, errors.join("; "));
    const body: SystemMapFindingRelatedResponse = {
      status: "ready",
      related: loaded.related,
      truncated: loaded.truncated,
      paths,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] finding related GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
