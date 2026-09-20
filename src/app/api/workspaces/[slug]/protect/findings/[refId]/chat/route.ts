import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getProtectFindingByRef } from "@/lib/protect/findings";
import { buildProtectJamieSeed, chooseProtectJamieTool } from "@/lib/protect/jamie-prompt";
import { validateUserBelongsToOrg } from "@/services/workspace";

const ORG_NOT_LINKED_ERROR = "This workspace is not linked to an organization";
const ORG_MEMBERSHIP_ERROR =
  "You must be a member of this organization to open an org-canvas chat";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; refId: string }> },
) {
  try {
    const { slug, refId } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const roleLevel = WORKSPACE_PERMISSION_LEVELS[member.role];
    if (roleLevel < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]) {
      return NextResponse.json({ error: "Write access required" }, { status: 403 });
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Workspace swarm is not configured" }, { status: 400 });
    }

    const finding = await getProtectFindingByRef(jarvisConfig, refId);
    if (!finding) {
      return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    }

    const workspace = await db.workspace.findUnique({
      where: { id: member.workspaceId },
      select: {
        sourceControlOrgId: true,
        sourceControlOrg: { select: { githubLogin: true } },
      },
    });

    const sourceControlOrgId = workspace?.sourceControlOrgId ?? null;
    const githubLogin = workspace?.sourceControlOrg?.githubLogin ?? null;
    if (!sourceControlOrgId || !githubLogin) {
      return NextResponse.json({ error: ORG_NOT_LINKED_ERROR }, { status: 400 });
    }

    const isOrgMember = await validateUserBelongsToOrg(githubLogin, member.userId);
    if (!isOrgMember) {
      return NextResponse.json({ error: ORG_MEMBERSHIP_ERROR }, { status: 403 });
    }

    const tool = await chooseProtectJamieTool(finding, sourceControlOrgId);
    const seed = buildProtectJamieSeed(finding, tool, slug);

    const existing = await db.sharedConversation.findFirst({
      where: {
        sourceControlOrgId,
        userId: member.userId,
        source: "org-canvas",
        archivedAt: null,
        AND: [
          { settings: { path: ["protectFindingRefId"], equals: finding.ref_id } },
          { settings: { path: ["protectWorkspaceSlug"], equals: slug } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        conversationId: existing.id,
        path: `/org/${githubLogin}?chat=${existing.id}`,
      });
    }

    const now = new Date().toISOString();
    const settings = {
      extraWorkspaceSlugs: [slug],
      protectFindingRefId: finding.ref_id,
      protectTool: tool,
      protectWorkspaceSlug: slug,
    };

    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId,
        workspaceId: null,
        userId: member.userId,
        title: `Protect: ${finding.title}`.slice(0, 100),
        messages: [
          {
            id: `protect-${finding.ref_id}`,
            role: "user",
            content: seed,
            timestamp: now,
          },
        ],
        followUpQuestions: [],
        isShared: false,
        lastMessageAt: new Date(),
        source: "org-canvas",
        settings: settings as unknown as never,
      },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      conversationId: conversation.id,
      path: `/org/${githubLogin}?chat=${conversation.id}`,
    });
  } catch (error) {
    console.error("[Protect] jamie action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
