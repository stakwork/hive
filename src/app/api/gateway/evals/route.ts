/**
 * POST /api/gateway/evals
 *
 * Create an EvalSet node in the workspace's Jarvis graph.
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 */
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import { addNode } from "@/services/swarm/api/nodes";

export async function POST(request: NextRequest) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;

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

    console.log(`[Gateway Evals POST] workspaceId=${workspaceId}, keyId=${keyId}`);

    const id = randomUUID();
    const result = await addNode(
      { jarvisUrl, apiKey: swarmApiKey },
      { node_type: "EvalSet", node_data: { id, name: name.trim(), description } },
    );

    if (!result.success) {
      console.error(`[Gateway Evals POST] addNode failed: ${result.error}`, { workspaceId });
      return NextResponse.json({ error: result.error ?? "Failed to create eval set" }, { status: 502 });
    }

    if (result.alreadyExists) {
      console.warn(`[Gateway Evals POST] EvalSet already exists`, { workspaceId, ref_id: result.ref_id });
      return NextResponse.json({ error: "Eval set already exists" }, { status: 409 });
    }

    return NextResponse.json({ ref_id: result.ref_id }, { status: 201 });
  } catch (error) {
    console.error("[Gateway Evals POST] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
