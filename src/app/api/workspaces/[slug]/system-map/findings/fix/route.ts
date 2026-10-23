/**
 * GET  /api/workspaces/:slug/system-map/findings/fix
 *       — the fixes tracked on Finding nodes; status and PR read from their strut runs.
 * POST /api/workspaces/:slug/system-map/findings/fix  { refIds: string[] }
 *       — for each confirmed, fixable finding, seed an org-canvas chat and
 *       launch the orchestrator strut (as Protect's Jamie does), which starts
 *       a job that opens a PR; up to MAX_FIX_BATCH. DEVELOPER and up. Ineligible or
 *       already-fixing findings are returned in `refused`; 409 when
 *       nothing could be started.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { isFindingRefId } from "@/lib/system-map/findings";
import { FindingFixError, listFixes, startFindingFixes } from "@/services/system-map/finding-fix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIX_RATE_LIMIT = 30;
const FIX_WINDOW_SECS = 60 * 60;

async function authorize(request: NextRequest, slug: string) {
  const access = await resolveWorkspaceAccess(request, { slug });
  const member = requireProtectMemberAccess(access);
  if (member instanceof NextResponse) return member;
  if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return member;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorize(request, slug);
    if (member instanceof NextResponse) return member;
    return NextResponse.json({ fixes: await listFixes(member.workspaceId) });
  } catch (error) {
    console.error("[SystemMap] finding fix GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorize(request, slug);
    if (member instanceof NextResponse) return member;

    if (WORKSPACE_PERMISSION_LEVELS[member.role] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]) {
      return NextResponse.json({ error: "Developer access required" }, { status: 403 });
    }

    const payload = (await request.json().catch(() => ({}))) as { refIds?: unknown };
    if (
      !Array.isArray(payload.refIds) ||
      !payload.refIds.every((id): id is string => typeof id === "string" && isFindingRefId(id))
    ) {
      return NextResponse.json({ error: "refIds must be Finding ref_ids" }, { status: 400 });
    }

    const rate = await checkRateLimit(`system-map:fix:${member.workspaceId}`, FIX_RATE_LIMIT, FIX_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many fix requests. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    const result = await startFindingFixes({
      workspaceId: member.workspaceId,
      workspaceSlug: member.slug,
      userId: member.userId,
      refIds: payload.refIds,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    });
    if (result.started.length === 0) {
      return NextResponse.json({ error: result.refused[0]?.reason ?? "Nothing to fix", ...result }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...result }, { status: 202 });
  } catch (error) {
    if (error instanceof FindingFixError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[SystemMap] finding fix POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
