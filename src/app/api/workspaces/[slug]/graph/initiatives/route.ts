import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { listInitiatives } from "@/services/graph/workbench";

export const runtime = "nodejs";

const MAX_LIMIT = 50;

/**
 * GET /api/workspaces/[slug]/graph/initiatives[?limit=5]
 *
 * The workspace's initiatives in the graph, newest first, as
 * `{ initiatives: [{ ref_id, name, status, created_at, created_by, … }], building }`.
 * Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const asked = Number(request.nextUrl.searchParams.get("limit") ?? 5);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : 5;
  const result = await listInitiatives({ slug, userId: access.userId }, limit);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
