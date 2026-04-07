import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const userId = userOrResponse.id;

  try {
    const workspaces = await db.workspace.findMany({
      where: {
        deleted: false,
        sourceControlOrg: { githubLogin },
        OR: [
          { ownerId: userId },
          { members: { some: { userId, leftAt: null } } },
        ],
      },
      include: {
        sourceControlOrg: true,
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    });

    const result = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      slug: ws.slug,
      ownerId: ws.ownerId,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
      userRole: (ws.ownerId === userId ? "OWNER" : "MEMBER") as WorkspaceRole | "OWNER" | "MEMBER",
      memberCount: ws._count.members + 1, // +1 for owner
      logoKey: ws.logoKey,
      logoUrl: ws.logoUrl,
      sourceControlOrg: ws.sourceControlOrg
        ? {
            id: ws.sourceControlOrg.id,
            githubLogin: ws.sourceControlOrg.githubLogin,
            name: ws.sourceControlOrg.name,
            avatarUrl: ws.sourceControlOrg.avatarUrl,
            type: ws.sourceControlOrg.type,
          }
        : null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/workspaces] Error:", error);
    return NextResponse.json({ error: "Failed to fetch org workspaces" }, { status: 500 });
  }
}
