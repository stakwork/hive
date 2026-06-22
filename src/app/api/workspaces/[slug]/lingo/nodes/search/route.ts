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
  const q = searchParams.get("q");
  const type = searchParams.get("type");

  if (!q) {
    return NextResponse.json({ success: false, error: "Query parameter 'q' is required" }, { status: 400 });
  }

  // Mock fallback
  if (process.env.USE_MOCKS === "true") {
    const results = mockLingoNodes.filter((n) =>
      n.name.toLowerCase().includes(q.toLowerCase()),
    );
    return NextResponse.json({ success: true, data: results });
  }

  const swarmResult = await getWorkspaceSwarmAccess(slug, user.id);
  if (!swarmResult.success) {
    const { type: errorType } = swarmResult.error;
    if (errorType === "WORKSPACE_NOT_FOUND") {
      return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });
    }
    if (errorType === "ACCESS_DENIED") {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }
    if (
      errorType === "SWARM_NOT_CONFIGURED" ||
      errorType === "SWARM_NAME_MISSING" ||
      errorType === "SWARM_API_KEY_MISSING"
    ) {
      const results = mockLingoNodes.filter((n) =>
        n.name.toLowerCase().includes(q.toLowerCase()),
      );
      return NextResponse.json({ success: true, data: results });
    }
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  const queryParams = new URLSearchParams({ q });
  if (type) queryParams.set("type", type);

  try {
    const response = await fetch(`${jarvisUrl}/nodes/search?${queryParams}`, {
      method: "GET",
      headers: {
        "x-api-token": swarmApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[Lingo nodes/search] Jarvis returned ${response.status}, falling back to mock`);
      const results = mockLingoNodes.filter((n) =>
        n.name.toLowerCase().includes(q.toLowerCase()),
      );
      return NextResponse.json({ success: true, data: results });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data: Array.isArray(data) ? data : (data?.nodes ?? []) });
  } catch (err) {
    console.error("[Lingo nodes/search] Jarvis fetch failed, falling back to mock", err);
    const results = mockLingoNodes.filter((n) =>
      n.name.toLowerCase().includes(q.toLowerCase()),
    );
    return NextResponse.json({ success: true, data: results });
  }
}
