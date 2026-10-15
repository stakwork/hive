/**
 * GET /api/workspaces/:slug/system-map/findings
 *      — the workspace graph's `Finding` nodes (namespace `infosec`), read through boltwall.
 *      Backs the Infosec page's Findings tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings } from "@/lib/system-map/findings";
import type { SystemMapFindingsResponse } from "@/types/system-map";

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

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ status: "error", error: "Workspace swarm is not configured" } satisfies SystemMapFindingsResponse);
    }

    const listed = await listFindings(jarvisConfig);
    const body: SystemMapFindingsResponse = listed.ok
      ? { status: "ready", findings: listed.findings, truncated: listed.truncated }
      : { status: "error", error: listed.error };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[SystemMap] findings GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
