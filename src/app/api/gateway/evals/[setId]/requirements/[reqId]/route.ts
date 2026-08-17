/**
 * PUT /api/gateway/evals/:setId/requirements/:reqId   — update an EvalRequirement
 * DELETE /api/gateway/evals/:setId/requirements/:reqId — delete an EvalRequirement
 *
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 *
 * `setId`/`reqId` are caller-supplied, so PUT resolves both against the key's
 * own swarm before writing; see `resolveEvalSetScope`.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import {
  checkGatewayWriteRateLimit,
  coerce,
  findRequirement,
  hasContestedKey,
  resolveEvalSetScope,
} from "@/lib/evals/requirement-writes";
import { updateNode, deleteNode } from "@/services/swarm/api/nodes";

type RouteParams = { params: Promise<{ setId: string; reqId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId, reqId } = await params;

    const limited = await checkGatewayWriteRateLimit(keyId, "put");
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

    // Tri-state: `undefined` means "leave the stored value alone". updateNode is
    // a partial merge, so coercing an omitted key to `false` here would make
    // every unrelated name/description edit clobber an agent-set `true`.
    let contested: boolean | undefined;
    if (hasContestedKey(body)) {
      const coerced = coerce(body.contested, "contested");
      if (!coerced.ok) {
        return NextResponse.json({ error: coerced.error }, { status: 400 });
      }
      contested = coerced.value;
    }

    console.log(`[Gateway Evals Requirements PUT] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}, reqId=${reqId}`);

    const config = { jarvisUrl, apiKey: swarmApiKey };

    // Ownership: neither `setId` nor `reqId` is proven by the API key. Resolve
    // both in the key's own swarm before writing — and read the pre-image of
    // `contested` from the same response, so the transition log below costs no
    // extra Jarvis call.
    const scope = await resolveEvalSetScope(config, setId);
    if (!scope.ok) {
      console.warn(`[Gateway Evals Requirements PUT] Eval set not writable: ${scope.error}`, { workspaceId, keyId });
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const existing = findRequirement(scope.requirements, reqId);
    if (!existing) {
      console.warn(`[Gateway Evals Requirements PUT] Requirement not in eval set`, { workspaceId, keyId });
      return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    }
    const contestedBefore = existing.properties?.contested;

    const result = await updateNode(config, {
      ref_id: reqId,
      node_type: "EvalRequirement",
      node_data: {
        name: name.trim(),
        description,
        prompt_snippet: typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
        desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
        undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
        ...(contested !== undefined ? { contested } : {}),
      },
    });

    if (!result.success) {
      console.error(`[Gateway Evals Requirements PUT] updateNode failed: ${result.error}`, { workspaceId, reqId });
      return NextResponse.json({ error: result.error ?? "Failed to update requirement" }, { status: 502 });
    }

    // Explicit scalars only. Never spread `authOrResponse` (it holds the
    // decrypted swarmApiKey) or the raw body into a log line.
    if (contested !== undefined) {
      console.log(
        `[Gateway Evals Requirements PUT] contested transition setId=${setId}, reqId=${reqId}, keyId=${keyId}, contestedBefore=${String(contestedBefore)}, contestedAfter=${contested}`,
      );
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
