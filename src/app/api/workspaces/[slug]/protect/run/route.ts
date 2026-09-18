import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  dispatchFullProtectReview,
  isSecurityReviewEnabled,
  PROTECT_ERRORS,
} from "@/services/protect";

const FULL_REVIEW_RATE_LIMIT = 5;
const FULL_REVIEW_WINDOW_SECS = 60 * 60;

export async function POST(
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

    const roleLevel = WORKSPACE_PERMISSION_LEVELS[member.role];
    if (roleLevel < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN]) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const enabled = await isSecurityReviewEnabled(member.workspaceId);
    if (!enabled) {
      return NextResponse.json({ error: PROTECT_ERRORS.SECURITY_REVIEW_DISABLED }, { status: 400 });
    }

    const rate = await checkRateLimit(
      `protect:full:${member.workspaceId}`,
      FULL_REVIEW_RATE_LIMIT,
      FULL_REVIEW_WINDOW_SECS,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: PROTECT_ERRORS.RATE_LIMITED },
        {
          status: 429,
          headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined,
        },
      );
    }

    const run = await dispatchFullProtectReview({
      workspaceId: member.workspaceId,
      workspaceSlug: member.slug,
      userId: member.userId,
    });

    return NextResponse.json({
      success: true,
      run: {
        id: run.id,
        mode: run.mode,
        status: run.status,
        repositoryUrl: run.repositoryUrl,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[Protect] full review trigger error:", error);

    if (error instanceof Error) {
      if (error.message === PROTECT_ERRORS.RUN_IN_PROGRESS) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (
        error.message === PROTECT_ERRORS.NO_REPOSITORIES ||
        error.message === PROTECT_ERRORS.EMPTY_SCOPE ||
        error.message === PROTECT_ERRORS.MISSING_GITHUB_CREDENTIALS ||
        error.message === PROTECT_ERRORS.SECURITY_REVIEW_DISABLED ||
        error.message === PROTECT_ERRORS.WORKFLOW_NOT_CONFIGURED ||
        error.message === PROTECT_ERRORS.STAKWORK_NOT_CONFIGURED
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
