import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getChoiceTree } from "@/services/graph/workbench";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[slug]/graph/choice-tree?focus=<ref_id>[&label=Choice[,Question]]
 *
 * The brainstorm tree under `focus`: its `PARENT_OF` descendants labelled
 * `Choice` or `Question` with the edges among them. `label` (legacy) narrows
 * it to one label, or a comma list. Any member may read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;

  const focus = request.nextUrl.searchParams.get("focus");
  if (!focus) return NextResponse.json({ error: "focus is required" }, { status: 400 });
  const label = request.nextUrl.searchParams.get("label");
  const labels = label ? label.split(",").map((l) => l.trim()) : undefined;
  const result = await getChoiceTree({ slug, userId: access.userId }, focus, labels);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
