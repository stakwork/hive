import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { addNode } from "@/services/swarm/api/nodes";
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

  // Mock fallback — dev/test only, never fires in production
  if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
    const sorted = [...mockLingoNodes].sort(
      (a, b) => b.date_added_to_graph - a.date_added_to_graph,
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
      return NextResponse.json({ success: true, data: { nodes: [], hasMore: false } });
    }
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  const queryParams = new URLSearchParams({
    type: "Lingo",
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
      console.warn(`[Lingo nodes] Jarvis returned ${response.status}`);
      return NextResponse.json(
        { success: false, error: "Failed to fetch Lingo nodes" },
        { status: 500 },
      );
    }

    const data = await response.json();
    const rawNodes = Array.isArray(data) ? data : (data?.nodes ?? []);
    const nodes = rawNodes.map((n: {
      ref_id: string;
      node_type: string;
      date_added_to_graph: number;
      properties?: { name?: string; definition?: string };
    }) => ({
      ref_id: n.ref_id,
      node_type: n.node_type,
      name: n.properties?.name,
      definition: n.properties?.definition ?? null,
      date_added_to_graph: n.date_added_to_graph,
    }));

    return NextResponse.json({
      success: true,
      data: { nodes, hasMore: nodes.length === limit },
    });
  } catch (err) {
    console.error("[Lingo nodes] Jarvis fetch failed", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Lingo nodes" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  const body = await request.json().catch(() => ({})) as { name?: string; definition?: string; lingo_type?: string };
  const name = body.name?.trim() ?? "";
  const definition = body.definition?.trim() || undefined;
  const lingo_type = body.lingo_type?.trim() || undefined;

  if (!name) {
    return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
  }

  // Mock fallback — dev/test only
  if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
    return NextResponse.json({
      success: true,
      data: { ref_id: "mock-lingo-ref", name, definition, ...(lingo_type ? { lingo_type } : {}) },
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
    return NextResponse.json({ success: false, error: "Swarm unavailable" }, { status: 503 });
  }

  const { swarmName, swarmApiKey } = swarmResult.data;
  const jarvisUrl = getJarvisUrl(swarmName);

  const result = await addNode(
    { jarvisUrl, apiKey: swarmApiKey },
    { node_type: "Lingo", node_data: { name, definition, ...(lingo_type ? { lingo_type } : {}) } },
  );

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error ?? "Failed to create node" },
      { status: 500 },
    );
  }

  const responseBody: {
    success: boolean;
    data: { ref_id?: string; name: string; definition?: string; lingo_type?: string };
    alreadyExists?: boolean;
  } = { success: true, data: { ref_id: result.ref_id, name, definition, ...(lingo_type ? { lingo_type } : {}) } };

  if (result.alreadyExists) {
    responseBody.alreadyExists = true;
  }

  return NextResponse.json(responseBody);
}
