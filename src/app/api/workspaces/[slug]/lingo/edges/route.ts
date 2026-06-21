import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { addEdge } from "@/services/swarm/api/nodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

  let body: { source_ref_id: string; target_ref_id: string; edge_type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { source_ref_id, target_ref_id, edge_type = "RELATED_TO" } = body;
  if (!source_ref_id || !target_ref_id) {
    return NextResponse.json(
      { success: false, error: "source_ref_id and target_ref_id are required" },
      { status: 400 },
    );
  }

  // Mock fallback
  if (process.env.USE_MOCKS === "true") {
    return NextResponse.json({ success: true, data: { edge_type, source_ref_id, target_ref_id } });
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

  const result = await addEdge(
    { jarvisUrl, apiKey: swarmApiKey },
    {
      edge: { edge_type },
      source: { ref_id: source_ref_id },
      target: { ref_id: target_ref_id },
    },
  );

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
