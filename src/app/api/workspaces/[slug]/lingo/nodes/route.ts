import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { mockLingoNodes } from "@/app/api/mock/lingo/nodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

  // Mock fallback
  if (process.env.USE_MOCKS === "true") {
    const sorted = [...mockLingoNodes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const page = sorted.slice(offset, offset + limit);
    return NextResponse.json({
      success: true,
      data: { nodes: page, hasMore: page.length === limit },
    });
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
      // Fall back to mock data when swarm is not configured
      const sorted = [...mockLingoNodes].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const page = sorted.slice(offset, offset + limit);
      return NextResponse.json({
        success: true,
        data: { nodes: page, hasMore: page.length === limit },
      });
    }
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  const queryParams = new URLSearchParams({
    type: "Jargon",
    namespace: swarmName,
    limit: String(limit),
    offset: String(offset),
    sort: "created_at:desc",
  });

  try {
    const response = await fetch(`${jarvisUrl}/v2/nodes?${queryParams}`, {
      method: "GET",
      headers: {
        "x-api-token": swarmApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Jarvis returned ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const nodes = Array.isArray(data) ? data : (data?.nodes ?? []);
    return NextResponse.json({
      success: true,
      data: { nodes, hasMore: nodes.length === limit },
    });
  } catch (err) {
    console.error("[Lingo nodes] Jarvis fetch failed, falling back to mock", err);
    const sorted = [...mockLingoNodes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const page = sorted.slice(offset, offset + limit);
    return NextResponse.json({
      success: true,
      data: { nodes: page, hasMore: page.length === limit },
    });
  }
}
