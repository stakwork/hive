/**
 * PUT /api/gateway/evals/:setId   — rename / update an EvalSet
 * DELETE /api/gateway/evals/:setId — delete an EvalSet
 *
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import { updateNode, deleteNode } from "@/services/swarm/api/nodes";

type RouteParams = { params: Promise<{ setId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { name, description } = body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    console.log(`[Gateway Evals PUT] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}`);

    const result = await updateNode(
      { jarvisUrl, apiKey: swarmApiKey },
      { ref_id: setId, node_type: "EvalSet", node_data: { name: name.trim(), description } },
    );

    if (!result.success) {
      console.error(`[Gateway Evals PUT] updateNode failed: ${result.error}`, { workspaceId, setId });
      return NextResponse.json({ error: result.error ?? "Failed to update eval set" }, { status: 502 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Gateway Evals PUT] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId } = await params;

    console.log(`[Gateway Evals DELETE] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}`);

    const result = await deleteNode({ jarvisUrl, apiKey: swarmApiKey }, setId);

    if (!result.success) {
      console.error(`[Gateway Evals DELETE] deleteNode failed: ${result.error}`, { workspaceId, setId });
      return NextResponse.json({ error: result.error ?? "Failed to delete eval set" }, { status: 502 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Gateway Evals DELETE] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
