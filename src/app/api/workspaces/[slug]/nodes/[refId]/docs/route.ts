import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";

type RouteParams = { params: Promise<{ slug: string; refId: string }> };

/**
 * Write a Concept node's `docs` straight to Jarvis, addressed by its graph
 * `ref_id` (gitree's route is keyed by the concept's slug `id`, which not
 * every Concept has). Only `Concept` nodes are accepted, which also keeps the
 * mirror-owned types out.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, refId } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.docs !== "string") {
      return NextResponse.json({ error: "docs must be a string" }, { status: 400 });
    }
    const docs: string = body.docs;

    const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
    if (access instanceof NextResponse) return access;
    if (!hasRoleLevel(access.role, WorkspaceRole.DEVELOPER)) {
      return NextResponse.json({ error: "Developer access required" }, { status: 403 });
    }

    const workspace = await db.workspace.findFirst({
      where: { id: access.workspaceId, deleted: false },
      select: { sourceControlOrgId: true },
    });
    const resolved = workspace?.sourceControlOrgId
      ? await resolveGraphJarvis(workspace.sourceControlOrgId, access.userId, {
          workspaceId: access.workspaceId,
        })
      : null;
    if (!resolved?.ok) {
      return NextResponse.json({ error: "Workspace not found or access denied." }, { status: 403 });
    }
    const { config } = resolved.access;

    const node = await readNodeByRef(config, refId);
    if (!node.success) {
      return NextResponse.json({ error: `Node "${refId}" not found` }, { status: 404 });
    }
    if (node.node_type !== "Concept") {
      return NextResponse.json({ error: "Only Concept nodes have editable docs" }, { status: 400 });
    }

    const result = await updateNodeV2(config, refId, { docs });
    if (!result.success) {
      return NextResponse.json(
        { error: result.message ?? "Failed to update node docs" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, ref_id: refId, docs });
  } catch (error) {
    console.error("Node docs update error:", error);
    return NextResponse.json({ error: "Failed to update node docs" }, { status: 500 });
  }
}
