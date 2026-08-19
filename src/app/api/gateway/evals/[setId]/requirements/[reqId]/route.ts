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
import { checkRateLimit } from "@/lib/rate-limit";
import { coerceContested } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/route";
import type { JarvisNode } from "@/types/jarvis";

type RouteParams = { params: Promise<{ setId: string; reqId: string }> };

/**
 * Fetch the eval set from Jarvis and verify:
 *   1. Fetch succeeded — fail closed on any error.
 *   2. The set node exists in the response.
 *   3. If the set carries a workspaceId property it matches the caller's workspace.
 *   4. reqId appears as an EvalRequirement child of the set.
 *
 * Returns the req node properties on success, or a NextResponse to short-circuit.
 */
async function verifyOwnership(
  jarvisUrl: string,
  swarmApiKey: string,
  setId: string,
  reqId: string,
  workspaceId: string,
): Promise<{ contestedBefore?: boolean } | NextResponse> {
  const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
  let res: Response;
  try {
    res = await fetch(
      `${jarvisUrl}/v2/nodes/${encodeURIComponent(setId)}?expand=edges&edge_type=${edgeType}&depth=1`,
      { headers: { "x-api-token": swarmApiKey } },
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await res.json();
  const setNode = (data?.nodes ?? []).find((n: JarvisNode) => n.ref_id === setId);
  if (!setNode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownerWorkspaceId =
    setNode.properties?.workspace_id ?? setNode.properties?.workspaceId;
  if (ownerWorkspaceId && ownerWorkspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const reqNodes: JarvisNode[] = (data?.nodes ?? []).filter(
    (n: JarvisNode) =>
      n.ref_id !== setId &&
      String(n.node_type ?? "").toLowerCase() === "evalrequirement",
  );
  const reqNode = reqNodes.find((n) => n.ref_id === reqId);
  if (!reqNode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contestedBefore =
    reqNode.properties?.contested !== undefined
      ? Boolean(reqNode.properties.contested)
      : undefined;

  return { contestedBefore };
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId, reqId } = await params;

    // Rate limit — 60 req/min per API key
    const rl = await checkRateLimit(`gateway:evals:req:put:${keyId}`, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : {},
        },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { name, description, prompt_snippet, desirable_cases, undesirable_cases, contested } =
      body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Validate `contested` before any Jarvis calls
    const contestedCoerced = coerceContested(contested);
    if (contestedCoerced === null) {
      return NextResponse.json(
        { error: "contested must be a boolean (true, false, 1, 0, \"true\", or \"false\")" },
        { status: 400 },
      );
    }

    // IDOR: verify reqId is reachable from setId and the set belongs to this
    // workspace — fail closed on any Jarvis error. This also gives us
    // contestedBefore for transition logging at no extra Jarvis call.
    const ownershipResult = await verifyOwnership(
      jarvisUrl, swarmApiKey, setId, reqId, workspaceId,
    );
    if (ownershipResult instanceof NextResponse) return ownershipResult;
    const { contestedBefore } = ownershipResult;

    // Log the transition — explicit scalars only, never spread authOrResponse
    // (holds decrypted swarmApiKey) or body (unvalidated).
    console.log(
      `[Gateway Evals Requirements PUT] setId=${setId}, reqId=${reqId}, keyId=${keyId}, ` +
        `contestedBefore=${contestedBefore}, contestedAfter=${contestedCoerced}`,
    );

    // Build node_data — omit `contested` key when undefined (tri-state write)
    const nodeData: Record<string, unknown> = {
      name: name.trim(),
      description,
      prompt_snippet: typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
      desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
      undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
    };
    if (contestedCoerced !== undefined) {
      nodeData.contested = contestedCoerced;
    }

    const result = await updateNode(
      { jarvisUrl, apiKey: swarmApiKey },
      {
        ref_id: reqId,
        node_type: "EvalRequirement",
        node_data: nodeData,
      },
    );

    if (!result.success) {
      console.error(`[Gateway Evals Requirements PUT] updateNode failed: ${result.error}`, {
        workspaceId,
        reqId,
      });
      return NextResponse.json(
        { error: result.error ?? "Failed to update requirement" },
        { status: 502 },
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

    // Rate limit — 60 req/min per API key (shared bucket with PUT)
    const rl = await checkRateLimit(`gateway:evals:req:put:${keyId}`, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : {},
        },
      );
    }

    // IDOR: verify reqId belongs to setId and the set belongs to this workspace
    // before deleting — fail closed on any Jarvis error.
    const ownershipResult = await verifyOwnership(
      jarvisUrl, swarmApiKey, setId, reqId, workspaceId,
    );
    if (ownershipResult instanceof NextResponse) return ownershipResult;

    console.log(
      `[Gateway Evals Requirements DELETE] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}, reqId=${reqId}`,
    );

    const result = await deleteNode({ jarvisUrl, apiKey: swarmApiKey }, reqId);

    if (!result.success) {
      console.error(
        `[Gateway Evals Requirements DELETE] deleteNode failed: ${result.error}`,
        { workspaceId, reqId },
      );
      return NextResponse.json(
        { error: result.error ?? "Failed to delete requirement" },
        { status: 502 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[Gateway Evals Requirements DELETE] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
