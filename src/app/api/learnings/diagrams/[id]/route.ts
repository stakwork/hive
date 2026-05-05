import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    const access = await resolveWorkspaceAccess(request, { slug: workspaceSlug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    // Find the diagram and confirm it belongs to this workspace
    const diagramWorkspace = await db.diagramWorkspace.findFirst({
      where: {
        workspaceId: ok.workspaceId,
        diagram: { id },
      },
      include: {
        diagram: { select: { id: true, groupId: true } },
      },
    });

    if (!diagramWorkspace) {
      return NextResponse.json({ error: "Diagram not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: diagramWorkspace.diagram.id,
      groupId: diagramWorkspace.diagram.groupId,
    });
  } catch (error) {
    console.error("Get diagram by ID API error:", error);
    return NextResponse.json({ error: "Failed to fetch diagram" }, { status: 500 });
  }
}
