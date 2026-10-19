import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { listBrainstormRoots } from "@/services/graph/workbench";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/brainstorms
 *
 * The workspace's brainstorm roots — questions nothing is parent of — newest
 * first, as `[{ ref_id, text, job, made_by }]`. Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const result = await listBrainstormRoots({ slug, userId: access.userId });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json({ brainstorms: result.data });
}
