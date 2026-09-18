import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listProtectFindings, redactSecretEvidence } from "@/lib/protect/findings";
import {
  getInFlightProtectReviewRun,
  getLatestCompletedFullProtectReviewRun,
  getLatestProtectReviewRun,
} from "@/services/protect";
import type { ProtectFindingsResponse, ProtectReviewRunSummary } from "@/types/protect";

function toRunSummary(
  run: {
    id: string;
    mode: "full" | "incremental";
    status: "pending" | "running" | "completed" | "failed";
    repositoryUrl: string | null;
    createdAt: Date;
    completedAt: Date | null;
  } | null,
): ProtectReviewRunSummary | null {
  if (!run) return null;
  return {
    id: run.id,
    mode: run.mode,
    status: run.status,
    repositoryUrl: run.repositoryUrl,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [inFlight, completedFull, latest] = await Promise.all([
      getInFlightProtectReviewRun(member.workspaceId),
      getLatestCompletedFullProtectReviewRun(member.workspaceId),
      getLatestProtectReviewRun(member.workspaceId),
    ]);

    if (inFlight) {
      const body: ProtectFindingsResponse = {
        status: "in-progress",
        findings: [],
        run: toRunSummary(inFlight),
      };
      return NextResponse.json(body);
    }

    if (!completedFull) {
      const body: ProtectFindingsResponse = {
        status: "empty",
        findings: [],
        run: toRunSummary(latest),
      };
      return NextResponse.json(body);
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      const body: ProtectFindingsResponse = {
        status: "error",
        findings: [],
        run: toRunSummary(completedFull),
        error: "Workspace swarm is not configured",
      };
      return NextResponse.json(body);
    }

    const listed = await listProtectFindings(jarvisConfig);
    if (!listed.ok) {
      const body: ProtectFindingsResponse = {
        status: "error",
        findings: [],
        run: toRunSummary(completedFull),
        error: listed.error,
      };
      return NextResponse.json(body);
    }

    const body: ProtectFindingsResponse = {
      status: "ready",
      findings: listed.findings.map(redactSecretEvidence),
      run: toRunSummary(completedFull),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[Protect] findings GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
