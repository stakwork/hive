import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  validateWorkspaceAccess,
} from "@/services/workspace";
import { isAssignableMemberRole } from "@/lib/auth/roles";

export const runtime = "nodejs";

// PATCH /api/workspaces/[slug]/members/[userId] - Update member role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, userId: targetUserId } = await params;
    const requesterId = (session.user as { id: string }).id;
    const body = await request.json();

    const { role } = body;

    if (!role) {
      return NextResponse.json({ error: "Role is required" }, { status: 400 });
    }

    // Validate role
    if (!isAssignableMemberRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, requesterId);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const updatedMember = await updateWorkspaceMemberRole(access.workspace.id, targetUserId, role);
    return NextResponse.json({ member: updatedMember });
  } catch (error: unknown) {
    console.error("Error updating workspace member role:", error);
    
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to update member role" },
      { status: 500 }
    );
  }
}

// DELETE /api/workspaces/[slug]/members/[userId] - Remove member from workspace
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, userId: targetUserId } = await params;
    const requesterId = (session.user as { id: string }).id;

    // Check workspace access and admin permissions
    const access = await validateWorkspaceAccess(slug, requesterId);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!access.workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Prevent removing workspace owner
    if (access.workspace.ownerId === targetUserId) {
      return NextResponse.json(
        { error: "Cannot remove workspace owner" },
        { status: 400 }
      );
    }

    await removeWorkspaceMember(access.workspace.id, targetUserId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error removing workspace member:", error);
    
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    );
  }
}