import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import type { OrgMemberResponse } from "@/types/workspace";

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
    // Get workspace IDs in this org accessible to the user
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

    // Get all memberships across those workspaces, including description and workspace name
    const memberships = await db.workspaceMember.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        leftAt: null,
      },
      select: {
        userId: true,
        workspaceId: true,
        description: true,
        workspace: {
          select: { name: true },
        },
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

    // Group all memberships by userId
    const memberMap = new Map<string, OrgMemberResponse>();

    for (const m of memberships) {
      const existing = memberMap.get(m.userId);
      const wsDesc = {
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        description: m.description,
      };

      if (existing) {
        existing.workspaceDescriptions.push(wsDesc);
      } else {
        memberMap.set(m.userId, {
          id: m.user.id,
          name: m.user.name,
          image: m.user.image,
          githubUsername: m.user.githubAuth?.githubUsername ?? null,
          workspaceDescriptions: [wsDesc],
        });
      }
    }

    return NextResponse.json(Array.from(memberMap.values()));
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/members] Error:", error);
    return NextResponse.json({ error: "Failed to fetch org members" }, { status: 500 });
  }
}
