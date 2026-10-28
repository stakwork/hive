/**
 * GET /api/workspaces/:slug/system-map/security-audit/classes
 *      — the Security audit tab's attack classes with descriptions, read live
 *      from the hive strut's "Security Audit" Concepts (built-in text when
 *      they can't be read).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getSecurityAuditClasses } from "@/lib/system-map/security-audit-classes";

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

    return NextResponse.json({ classes: await getSecurityAuditClasses(member.workspaceId, member.userId) });
  } catch (error) {
    console.error("[SystemMap] security-audit classes GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
