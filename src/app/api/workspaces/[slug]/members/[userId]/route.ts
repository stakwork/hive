import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  validateWorkspaceAccess,
} from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";
import { unauthorized, badRequest, notFound, forbidden } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

export const runtime = "nodejs";

// PATCH /api/workspaces/[slug]/members/[userId] - Update member role
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; userId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw unauthorized("Unauthorized");
    }

    const { slug, userId: targetUserId } = await params;
    const requesterId = (session.user as { id: string }).id;
    const body = await request.json();

    const { role } = body;

    if (!role) {
      throw badRequest("Role is required");
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      throw badRequest("Invalid role");
    }

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, requesterId);
    if (!access.hasAccess || !access.canAdmin) {
      throw forbidden("Admin access required");
    }

    if (!access.workspace) {
      throw notFound("Workspace not found");
    }

    const updatedMember = await updateWorkspaceMemberRole(access.workspace.id, targetUserId, role);
    return NextResponse.json({ member: updatedMember });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

// DELETE /api/workspaces/[slug]/members/[userId] - Remove member from workspace
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; userId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw unauthorized("Unauthorized");
    }

    const { slug, userId: targetUserId } = await params;
    const requesterId = (session.user as { id: string }).id;

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, requesterId);
    if (!access.hasAccess || !access.canAdmin) {
      throw forbidden("Admin access required");
    }

    if (!access.workspace) {
      throw notFound("Workspace not found");
    }

    // Prevent removing workspace owner
    if (access.workspace.ownerId === targetUserId) {
      throw badRequest("Cannot remove workspace owner");
    }

    await removeWorkspaceMember(access.workspace.id, targetUserId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}