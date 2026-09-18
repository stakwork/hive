import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import {
  addRepositoryToProtectScope,
  getProtectScopePayload,
  removeRepositoryFromProtectScope,
} from "@/lib/protect/scope";

const putSchema = z
  .object({
    repositoryId: z.string().min(1),
    inScope: z.boolean(),
  })
  .strict();

function requireAdmin(role: WorkspaceRole) {
  const roleLevel = WORKSPACE_PERMISSION_LEVELS[role];
  return roleLevel >= WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN];
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

    const scope = await getProtectScopePayload(member.workspaceId);
    return NextResponse.json({ success: true, scope });
  } catch (error) {
    console.error("[Protect] scope GET error:", error);
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

    if (!requireAdmin(member.role)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "repositoryId and inScope are required" },
        { status: 400 },
      );
    }

    try {
      const scope = parsed.data.inScope
        ? await addRepositoryToProtectScope(member.workspaceId, parsed.data.repositoryId)
        : await removeRepositoryFromProtectScope(member.workspaceId, parsed.data.repositoryId);

      return NextResponse.json({ success: true, scope });
    } catch (error) {
      if (error instanceof Error && error.message === "REPOSITORY_NOT_FOUND") {
        return NextResponse.json({ error: "Repository not found" }, { status: 404 });
      }
      throw error;
    }
  } catch (error) {
    console.error("[Protect] scope PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
