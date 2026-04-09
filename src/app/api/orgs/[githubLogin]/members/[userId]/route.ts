import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; userId: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, userId } = await params;
  const requesterId = userOrResponse.id;

  let body: { workspaceId: string; description: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspaceId, description } = body;

  if (!workspaceId || typeof description !== "string") {
    return NextResponse.json(
      { error: "workspaceId and description are required" },
      { status: 400 }
    );
  }

  try {
    // Verify the requester is a member of at least one workspace in this org
    const accessibleWorkspaces = await db.workspace.findMany({
      where: {
        deleted: false,
        sourceControlOrg: { githubLogin },
        OR: [
          { ownerId: requesterId },
          { members: { some: { userId: requesterId, leftAt: null } } },
        ],
      },
      select: { id: true },
    });

    if (accessibleWorkspaces.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Ensure the target workspaceId belongs to this org
    const workspaceIds = accessibleWorkspaces.map((w) => w.id);
    if (!workspaceIds.includes(workspaceId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update the WorkspaceMember record
    const updated = await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { description },
      select: { workspaceId: true, description: true },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    // Prisma record-not-found error code
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2025"
    ) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    console.error("[PATCH /api/orgs/[githubLogin]/members/[userId]] Error:", error);
    return NextResponse.json({ error: "Failed to update member description" }, { status: 500 });
  }
}
