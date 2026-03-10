import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const isSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);
    const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id, true, {
      isSuperAdmin,
    });

    if (!workspaceAccess.hasAccess || !workspaceAccess.workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }

    const diagrams = await db.diagram.findMany({
      where: {
        workspaces: {
          some: {
            workspace: { slug: workspaceSlug },
          },
        },
      },
      select: {
        id: true,
        name: true,
        body: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(diagrams);
  } catch (error) {
    console.error("List diagrams API error:", error);
    return NextResponse.json({ error: "Failed to fetch diagrams" }, { status: 500 });
  }
}
