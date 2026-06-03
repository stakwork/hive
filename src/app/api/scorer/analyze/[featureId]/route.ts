import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { generateDigest } from "@/lib/scorer/digest";
import { cacheFeatureAgentStats } from "@/lib/scorer/agent-stats";
import { analyzeSingleSession } from "@/lib/scorer/analysis";

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * POST /api/scorer/analyze/[featureId]
 *
 * Workspace-scoped endpoint that runs the full scorer pipeline:
 *   generateDigest → cacheFeatureAgentStats → analyzeSingleSession
 *
 * Accepts an optional `prompt` string in the body for a one-time override
 * (not persisted to the workspace). Requires OWNER role or superAdmin.
 *
 * Returns { insightCount, insights } after the pipeline completes.
 */
export async function POST(
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
    const member = requireMemberAccess(access);
    if (member instanceof NextResponse) return member;

    // Require OWNER role or superAdmin
    if (member.role !== WorkspaceRole.OWNER && !member.superAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse optional prompt from body
    let customPrompt: string | undefined;
    try {
      const body = await request.json();
      if (typeof body?.prompt === "string" && body.prompt.length > 0) {
        customPrompt = body.prompt;
      }
    } catch {
      // No body or invalid JSON — proceed without custom prompt
    }

    const workspaceId = feature.workspaceId;

    console.log(
      `[scorer/analyze] Starting pipeline for featureId=${featureId} workspaceId=${workspaceId} customPrompt=${!!customPrompt}`
    );

    await generateDigest(featureId);
    await cacheFeatureAgentStats(featureId);
    const result = await analyzeSingleSession(featureId, workspaceId, customPrompt);

    console.log(
      `[scorer/analyze] Pipeline complete for featureId=${featureId}: insightCount=${result.insightCount}`
    );

    // Re-fetch fresh insights to return to the UI
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

    return NextResponse.json({ insightCount: result.insightCount, insights });
  } catch (error) {
    console.error("Error running scorer analysis:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
