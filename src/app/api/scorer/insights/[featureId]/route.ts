import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { resolvePrompt } from "@/lib/scorer/prompts";

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * GET /api/scorer/insights/[featureId]
 *
 * Returns all non-dismissed ScorerInsight records for a feature, sorted
 * HIGH → MEDIUM → LOW then by recency. Also returns the effectivePrompt
 * so the UI can pre-populate the prompt editor textarea on mount.
 *
 * Returns { insights: [], effectivePrompt } (not 404) when no insights
 * exist — the UI needs effectivePrompt on every mount.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await context.params;

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    const access = await resolveWorkspaceAccess(request, {
      workspaceId: feature.workspaceId,
    });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: feature.workspaceId },
      select: { scorerSinglePrompt: true },
    });

    const insights = await db.scorerInsight.findMany({
      where: {
        featureIds: { has: featureId },
        dismissedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    insights.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 9;
      const sb = SEVERITY_ORDER[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const effectivePrompt = resolvePrompt("single", workspace.scorerSinglePrompt);

    return NextResponse.json({ insights, effectivePrompt });
  } catch (error) {
    console.error("Error fetching scorer insights:", error);
    return NextResponse.json(
      { error: "Failed to fetch insights" },
      { status: 500 }
    );
  }
}
