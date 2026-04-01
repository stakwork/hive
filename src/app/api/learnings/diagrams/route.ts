import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getMiddlewareContext, requireAuth, checkIsSuperAdmin } from "@/lib/middleware/utils";
import { Prisma } from "@prisma/client";

type DiagramRow = {
  id: string;
  name: string;
  body: string;
  description: string | null;
  created_at: Date;
  group_id: string;
};

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

    // Return only the most recently created version per groupId using DISTINCT ON
    const diagrams = await db.$queryRaw<DiagramRow[]>(Prisma.sql`
      SELECT DISTINCT ON (d.group_id)
        d.id, d.name, d.body, d.description, d.created_at, d.group_id
      FROM diagrams d
      JOIN diagram_workspaces dw ON dw.diagram_id = d.id
      JOIN workspaces w ON w.id = dw.workspace_id
      WHERE w.slug = ${workspaceSlug}
      ORDER BY d.group_id, d.created_at DESC
    `);

    // Map snake_case DB columns to camelCase for the response
    const result = diagrams.map((d) => ({
      id: d.id,
      name: d.name,
      body: d.body,
      description: d.description,
      createdAt: d.created_at,
      groupId: d.group_id,
    }));

    // Sort by createdAt descending to match the original ordering behaviour
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(result);
  } catch (error) {
    console.error("List diagrams API error:", error);
    return NextResponse.json({ error: "Failed to fetch diagrams" }, { status: 500 });
  }
}
