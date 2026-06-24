import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getNeighborData } from "@/app/api/mock/lingo/neighbors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  const { slug, ref_id } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  // Mock fallback — dev/test only, never fires in production
  if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
    const data = getNeighborData(ref_id);
    if (!data) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
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
    if (type === "SWARM_NOT_CONFIGURED" || type === "SWARM_NAME_MISSING" || type === "SWARM_API_KEY_MISSING") {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  try {
    const response = await fetch(
      `${jarvisUrl}/v2/nodes/${encodeURIComponent(ref_id)}?expand=true`,
      {
        method: "GET",
        headers: {
          "x-api-token": swarmApiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.warn(`[Lingo nodes/${ref_id}] Jarvis returned ${response.status}`);
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Lingo nodes/[ref_id]] Jarvis fetch failed", err);
    return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
  }
}
