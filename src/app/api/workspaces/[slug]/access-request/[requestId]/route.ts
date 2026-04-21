import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { addWorkspaceMember, updateWorkspaceMemberRole } from "@/services/workspace";
import { WorkspaceRole, WorkspaceAccessRequestStatus } from "@prisma/client";
import { hasRoleLevel } from "@/lib/auth/roles";
import { z } from "zod";

export const runtime = "nodejs";

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

/**
 * PATCH /api/workspaces/[slug]/access-request/[requestId]
 * Approve or reject a pending access request. Admin/Owner only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; requestId: string }> },
) {
  const { slug, requestId } = await params;

  const access = await resolveWorkspaceAccess(request, { slug });
  const ok = requireMemberAccess(access);
  if (ok instanceof NextResponse) return ok;

  if (!hasRoleLevel(ok.role as WorkspaceRole, WorkspaceRole.ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const { action } = parsed.data;

  // Load the request, confirming it belongs to this workspace
  const accessRequest = await db.workspaceAccessRequest.findFirst({
    where: { id: requestId, workspaceId: ok.workspaceId },
    include: {
      user: {
        select: {
          id: true,
          githubAuth: { select: { githubUsername: true } },
        },
      },
    },
  });

  if (!accessRequest) {
    return NextResponse.json({ error: "Access request not found" }, { status: 404 });
  }

  if (accessRequest.status !== WorkspaceAccessRequestStatus.PENDING) {
    return NextResponse.json(
      { error: "Request is no longer pending", status: accessRequest.status },
      { status: 409 },
    );
  }

  if (action === "approve") {
    // Add or upgrade the requester to DEVELOPER role
    const userId = accessRequest.userId;
    const githubUsername = accessRequest.user.githubAuth?.githubUsername;

    const existingMembership = await db.workspaceMember.findFirst({
      where: { workspaceId: ok.workspaceId, userId, leftAt: null },
      select: { role: true },
    });

    if (existingMembership) {
      await updateWorkspaceMemberRole(ok.workspaceId, userId, WorkspaceRole.DEVELOPER);
    } else if (githubUsername) {
      await addWorkspaceMember(ok.workspaceId, githubUsername, WorkspaceRole.DEVELOPER);
    } else {
      return NextResponse.json(
        { error: "User has no GitHub username; cannot add as member" },
        { status: 422 },
      );
    }
  }

  const updated = await db.workspaceAccessRequest.update({
    where: { id: requestId },
    data: {
      status:
        action === "approve"
          ? WorkspaceAccessRequestStatus.APPROVED
          : WorkspaceAccessRequestStatus.REJECTED,
      resolvedAt: new Date(),
      resolvedByUserId: ok.userId,
    },
  });

  return NextResponse.json({ request: updated });
}
