import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getHierarchy } from "@/services/graph/workbench";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/hierarchy?label=Concept
 *
 * Every node of one label in the workspace's graph, with the edges among
 * them, for the graph workbench to draw trees from. Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const label = request.nextUrl.searchParams.get("label") ?? "Concept";
  const result = await getHierarchy({ slug, userId: access.userId }, label);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
