/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/climbs/:climbId
 *     — one climb with its steps (a PENDING step whose callback never
 *     landed is settled from strut first).
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { getOpenHealthClimb } from "@/services/strut-runs/openhealth-climb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; climbId: string }> }) {
  try {
    const { slug, climbId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const climb = await getOpenHealthClimb(member.workspaceId, climbId);
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(climb);
  } catch (error) {
    console.error("[OpenHealth] climb GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
