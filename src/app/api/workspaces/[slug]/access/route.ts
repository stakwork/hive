import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug } = await params;

  try {
    // Find the workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Check if user is owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = !isOwner && await db.workspaceMember.findFirst({
      where: {
        workspaceId: workspace.id,
        userId,
        leftAt: null,
      },
    });

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Update or create WorkspaceMember record with lastAccessedAt timestamp
    await db.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId,
        },
      },
      update: {
        lastAccessedAt: new Date(),
      },
      create: {
        workspaceId: workspace.id,
        userId,
        role: isOwner ? "OWNER" : "VIEWER",
        lastAccessedAt: new Date(),
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to update workspace access:", error);
    return NextResponse.json(
      { error: "Failed to update workspace access" },
      { status: 500 }
    );
  }
}
