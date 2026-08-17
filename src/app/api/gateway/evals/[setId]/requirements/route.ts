/**
 * POST /api/gateway/evals/:setId/requirements
 *
 * Create an EvalRequirement node and link it to the EvalSet via HAS_REQUIREMENT edge.
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 *
 * `setId` is caller-supplied and therefore resolved against the key's own swarm
 * before any write; see `resolveEvalSetScope`.
 */
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import {
  checkGatewayWriteRateLimit,
  coerce,
  hasContestedKey,
  resolveEvalSetScope,
} from "@/lib/evals/requirement-writes";
import { addNode, addEdge } from "@/services/swarm/api/nodes";

type RouteParams = { params: Promise<{ setId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId } = await params;

    const limited = await checkGatewayWriteRateLimit(keyId, "post");
    if (limited) return limited;

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

    // On create, an omitted `contested` means "not contested" — unlike the
    // update path, where omission must preserve whatever is stored.
    let contested = false;
    if (hasContestedKey(body)) {
      const coerced = coerce(body.contested, "contested");
      if (!coerced.ok) {
        return NextResponse.json({ error: coerced.error }, { status: 400 });
      }
      contested = coerced.value;
    }

    console.log(`[Gateway Evals Requirements POST] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}`);

    const config = { jarvisUrl, apiKey: swarmApiKey };

    // Ownership + order in one read: the eval set must resolve inside the swarm
    // this API key maps to (the key alone proves nothing about `setId`), and its
    // HAS_REQUIREMENT children are the sibling count the new edge orders after.
    const scope = await resolveEvalSetScope(config, setId);
    if (!scope.ok) {
      console.warn(`[Gateway Evals Requirements POST] Eval set not writable: ${scope.error}`, { workspaceId, keyId });
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const siblingCount = scope.requirements.length;

    const id = randomUUID();
    const nodeResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: {
        id,
        name: name.trim(),
        description,
        prompt_snippet: typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
        desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
        undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
        contested,
      },
    });

    if (!nodeResult.success || !nodeResult.ref_id) {
      console.error(`[Gateway Evals Requirements POST] addNode failed: ${nodeResult.error}`, { workspaceId, setId });
      return NextResponse.json(
        { error: nodeResult.error ?? "Failed to create requirement node" },
        { status: 502 },
      );
    }

    const edgeResult = await addEdge(config, {
      edge: { edge_type: "HAS_REQUIREMENT", edge_data: { order: siblingCount } },
      source: { ref_id: setId },
      target: { ref_id: nodeResult.ref_id },
    });

    if (!edgeResult.success) {
      console.error(`[Gateway Evals Requirements POST] addEdge failed: ${edgeResult.error}`, { workspaceId, setId });
      return NextResponse.json(
        { error: edgeResult.error ?? "Failed to link requirement to eval set" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ref_id: nodeResult.ref_id }, { status: 201 });
  } catch (error) {
    console.error("[Gateway Evals Requirements POST] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
