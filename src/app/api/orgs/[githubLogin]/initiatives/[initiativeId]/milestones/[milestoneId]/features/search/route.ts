import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      githubLogin: string;
      initiativeId: string;
      milestoneId: string;
    }>;
  },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId, milestoneId } = await params;
  const userId = userOrResponse.id;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  const query = searchParams.get("query") ?? undefined;

  // If query is provided but under 3 chars, return empty immediately
  if (query !== undefined && query.length < 3) {
    return NextResponse.json([]);
  }

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify the milestone belongs to the initiative which belongs to this org
    // before returning any data, preventing enumeration via fabricated path params.
    const milestone = await db.milestone.findFirst({
      where: {
        id: milestoneId,
        initiativeId,
        initiative: { orgId },
      },
      select: { id: true },
    });
    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    // Fetch all non-deleted workspace IDs for the org
    const orgWorkspaces = await db.workspace.findMany({
      where: { deleted: false, sourceControlOrgId: orgId },
      select: { id: true },
    });
    const orgWorkspaceIds = orgWorkspaces.map((w) => w.id);

    if (orgWorkspaceIds.length === 0) {
      return NextResponse.json([]);
    }

    // If a workspaceId filter was supplied, confirm it belongs to this org
    // before using it in the query to prevent cross-org feature enumeration (IDOR).
    if (workspaceId && !orgWorkspaceIds.includes(workspaceId)) {
      return NextResponse.json([]);
    }

    const features = await db.feature.findMany({
      where: {
        deleted: false,
        workspaceId: workspaceId
          ? workspaceId
          : { in: orgWorkspaceIds },
        ...(query && query.length >= 3
          ? { title: { contains: query, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(features);
  } catch (error) {
    console.error(
      "[GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/features/search] Error:",
      error,
    );
    return NextResponse.json({ error: "Failed to search features" }, { status: 500 });
  }
}
