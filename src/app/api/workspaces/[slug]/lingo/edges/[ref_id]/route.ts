import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { validateWorkspaceAccess } from "@/services/workspace";
import { deleteEdge } from "@/services/swarm/api/nodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  const { slug, ref_id } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  const access = await validateWorkspaceAccess(slug, user.id);
  if (!access.hasAccess || !access.canWrite) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // Mock fallback
  if (process.env.USE_MOCKS === "true") {
    return NextResponse.json({ success: true });
  }

  const swarmResult = await getWorkspaceSwarmAccess(slug, user.id);
  if (!swarmResult.success) {
    const { type } = swarmResult.error;
    if (type === "WORKSPACE_NOT_FOUND") {
      return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });
    }
    if (type === "ACCESS_DENIED") {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  const result = await deleteEdge({ jarvisUrl, apiKey: swarmApiKey }, ref_id);

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.notFound ? 404 : 500 },
    );
  }

  return NextResponse.json({ success: true });
}
