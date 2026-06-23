import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { backfillFeatureConceptEdges } from "@/lib/graph-walker";

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = (await request.json()) as { orgId?: string; workspaceId?: string };

    if (!body.orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    const result = await backfillFeatureConceptEdges({
      orgId: body.orgId,
      workspaceId: body.workspaceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[FeatureConceptBridge] backfill endpoint error", error);
    return NextResponse.json({ error: "Failed to run backfill" }, { status: 500 });
  }
}
