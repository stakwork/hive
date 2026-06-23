import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { backfillFeatureConceptEdges } from "@/lib/graph-walker";

// Give each batch room to run; the backfill also self-limits via `budgetMs`
// (default 120s) so it returns a resumable cursor before this cap is hit.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = (await request.json()) as {
      orgId?: string;
      workspaceId?: string;
      cursor?: string;
      batchSize?: number;
      budgetMs?: number;
    };

    if (!body.orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    const result = await backfillFeatureConceptEdges({
      orgId: body.orgId,
      workspaceId: body.workspaceId,
      cursor: body.cursor,
      batchSize: body.batchSize,
      budgetMs: body.budgetMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[FeatureConceptBridge] backfill endpoint error", error);
    return NextResponse.json({ error: "Failed to run backfill" }, { status: 500 });
  }
}
