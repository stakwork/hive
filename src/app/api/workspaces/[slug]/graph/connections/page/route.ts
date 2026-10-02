import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { CONNECTION_PAGE, getConnectionPage } from "@/services/graph/workbench";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/connections/page?ref_id=&edge=&outgoing=&other=&limit=
 *
 * The first `limit` neighbours in one of a node's edge groups. "Show more"
 * asks again with a bigger limit. Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const p = request.nextUrl.searchParams;
  const result = await getConnectionPage(
    { slug, userId: access.userId },
    {
      refId: p.get("ref_id") ?? "",
      edge: p.get("edge") ?? "",
      outgoing: p.get("outgoing") === "true",
      other: p.get("other") ?? "",
      limit: Number(p.get("limit")) || CONNECTION_PAGE,
    },
  );
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
