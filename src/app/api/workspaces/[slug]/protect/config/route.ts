import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { getModelValue } from "@/lib/ai/models";
import {
  isProviderKeyConfigured,
  LLM_MODEL_OPTION_SELECT,
  publicUnexpiredLlmModelWhere,
} from "@/lib/ai/llm-model-availability";

const CONFIG_RATE_LIMIT = 20;
const CONFIG_RATE_WINDOW_SECS = 3600;

const putBodySchema = z.object({
  securityReviewModel: z.string().max(200).nullable(),
});

async function isAllowlistedModelValue(value: string): Promise<boolean> {
  const models = await db.llmModel.findMany({
    where: publicUnexpiredLlmModelWhere(),
    select: LLM_MODEL_OPTION_SELECT,
  });
  return models.some((model) => isProviderKeyConfigured(model) && getModelValue(model) === value);
}

async function getOrCreateJanitorConfigForWorkspace(workspaceId: string) {
  return db.janitorConfig.upsert({
    where: { workspaceId },
    create: { workspaceId },
    update: {},
    select: { securityReviewModel: true },
  });
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

    const config = await getOrCreateJanitorConfigForWorkspace(member.workspaceId);

    return NextResponse.json({
      securityReviewModel: config.securityReviewModel ?? null,
    });
  } catch (error) {
    console.error("[Protect] config GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
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

    const rate = await checkRateLimit(
      `protect:config:${member.workspaceId}`,
      CONFIG_RATE_LIMIT,
      CONFIG_RATE_WINDOW_SECS,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined,
        },
      );
    }

    const parsed = putBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { securityReviewModel } = parsed.data;
    if (securityReviewModel !== null) {
      const allowed = await isAllowlistedModelValue(securityReviewModel);
      if (!allowed) {
        return NextResponse.json({ error: "Model is not available" }, { status: 400 });
      }
    }

    const config = await db.janitorConfig.upsert({
      where: { workspaceId: member.workspaceId },
      create: { workspaceId: member.workspaceId, securityReviewModel },
      update: { securityReviewModel },
      select: { securityReviewModel: true },
    });

    return NextResponse.json({
      securityReviewModel: config.securityReviewModel ?? null,
    });
  } catch (error) {
    console.error("[Protect] config PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
