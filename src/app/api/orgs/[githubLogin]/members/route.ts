import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

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
    // First get workspace IDs in this org accessible to the user
    const accessibleWorkspaces = await db.workspace.findMany({
      where: {
        deleted: false,
        sourceControlOrg: { githubLogin },
        OR: [
          { ownerId: userId },
          { members: { some: { userId, leftAt: null } } },
        ],
      },
      select: { id: true },
    });

    const workspaceIds = accessibleWorkspaces.map((w) => w.id);

    if (workspaceIds.length === 0) {
      return NextResponse.json([]);
    }

    // Get all members across those workspaces
    const memberships = await db.workspaceMember.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        leftAt: null,
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            githubAuth: {
              select: { githubUsername: true },
            },
          },
        },
      },
    });

    // Deduplicate by userId
    const seen = new Set<string>();
    const members = memberships
      .filter((m) => {
        if (seen.has(m.userId)) return false;
        seen.add(m.userId);
        return true;
      })
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        image: m.user.image,
        githubUsername: m.user.githubAuth?.githubUsername ?? null,
      }));

    return NextResponse.json(members);
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/members] Error:", error);
    return NextResponse.json({ error: "Failed to fetch org members" }, { status: 500 });
  }
}
