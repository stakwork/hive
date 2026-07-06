/**
 * PUT /api/gateway/evals/:setId/requirements/:reqId   — update an EvalRequirement
 * DELETE /api/gateway/evals/:setId/requirements/:reqId — delete an EvalRequirement
 *
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import { updateNode, deleteNode } from "@/services/swarm/api/nodes";

type RouteParams = { params: Promise<{ setId: string; reqId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId, reqId } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { name, description, prompt_snippet, desirable_cases, undesirable_cases } = body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    console.log(`[Gateway Evals Requirements PUT] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}, reqId=${reqId}`);

    const result = await updateNode(
      { jarvisUrl, apiKey: swarmApiKey },
      {
        ref_id: reqId,
        node_type: "EvalRequirement",
        node_data: {
          name: name.trim(),
          description,
          prompt_snippet: typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
          desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
          undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
        },
      },
    );

    if (!result.success) {
      console.error(`[Gateway Evals Requirements PUT] updateNode failed: ${result.error}`, { workspaceId, reqId });
      return NextResponse.json({ error: result.error ?? "Failed to update requirement" }, { status: 502 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Gateway Evals Requirements PUT] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId, reqId } = await params;

    console.log(`[Gateway Evals Requirements DELETE] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}, reqId=${reqId}`);

    const result = await deleteNode({ jarvisUrl, apiKey: swarmApiKey }, reqId);

    if (!result.success) {
      console.error(`[Gateway Evals Requirements DELETE] deleteNode failed: ${result.error}`, { workspaceId, reqId });
      return NextResponse.json({ error: result.error ?? "Failed to delete requirement" }, { status: 502 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Gateway Evals Requirements DELETE] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
