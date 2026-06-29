import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getNeighborData } from "@/app/api/mock/lingo/neighbors";
import { deleteNode } from "@/services/swarm/api/nodes";

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
      `${jarvisUrl}/v2/nodes/${encodeURIComponent(ref_id)}?expand=edges`,
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

    const jarvisNodes: Record<string, unknown>[] = data.nodes ?? [];
    const jarvisEdges: Record<string, unknown>[] = data.edges ?? [];

    const nodeMap = Object.fromEntries(
      jarvisNodes.map((n) => [n.ref_id as string, n]),
    );

    const edges = jarvisEdges
      .map((e) => {
        const neighborRefId = e.source === ref_id ? e.target : e.source;
        const neighborNode = nodeMap[neighborRefId as string];
        return {
          edge_ref_id: e.ref_id as string,
          edge_type: e.edge_type as string,
          neighbor_node: {
            ref_id: neighborNode?.ref_id as string,
            name: ((neighborNode?.properties as Record<string, unknown>)?.name ??
                   neighborNode?.name) as string,
            node_type: neighborNode?.node_type as string,
          },
        };
      })
      .filter((e) => e.neighbor_node?.ref_id);

    const rawNode = nodeMap[ref_id] ?? data;
    const props = (rawNode?.properties as Record<string, unknown>) ?? {};
    const node = {
      ref_id: rawNode?.ref_id as string,
      node_type: rawNode?.node_type as string,
      name: (props.name ?? rawNode?.name) as string,
      definition: (props.definition ?? rawNode?.definition) as string | null | undefined,
      lingo_type: (props.lingo_type ?? rawNode?.lingo_type) as string | undefined,
      date_added_to_graph: (rawNode?.date_added_to_graph as number) ?? 0,
    };

    return NextResponse.json({ success: true, data: { node, edges } });
  } catch (err) {
    console.error("[Lingo nodes/[ref_id]] Jarvis fetch failed", err);
    return NextResponse.json({ success: false, error: "Node not found" }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; ref_id: string }> },
) {
  const { slug, ref_id } = await params;
  const ctx = getMiddlewareContext(request);
  const user = requireAuth(ctx);
  if (user instanceof NextResponse) return user;

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

  const result = await deleteNode({ jarvisUrl, apiKey: swarmApiKey }, ref_id);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
