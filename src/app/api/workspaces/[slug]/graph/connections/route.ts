import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getNodeConnections } from "@/services/graph/workbench";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/connections?ref_id=<id>
 *
 * One node of any type — its properties and every edge group around it, each
 * with a count and the first few neighbours. Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const refId = request.nextUrl.searchParams.get("ref_id") ?? "";
  const result = await getNodeConnections({ slug, userId: access.userId }, refId);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
