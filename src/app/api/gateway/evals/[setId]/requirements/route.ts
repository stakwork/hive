/**
 * POST /api/gateway/evals/:setId/requirements
 *
 * Create an EvalRequirement node and link it to the EvalSet via HAS_REQUIREMENT edge.
 * Authenticated via workspace API key (Bearer / x-api-key).
 * Workspace is derived solely from the key — no path/body scope.
 */
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveGatewayAuth } from "@/lib/evals/gateway-auth";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { checkRateLimit } from "@/lib/rate-limit";
import { coerceContested } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/route";
import type { JarvisNode } from "@/types/jarvis";

type RouteParams = { params: Promise<{ setId: string }> };

/** Strict ref_id pattern — alphanumeric plus hyphens and underscores only */
const REF_ID_RE = /^[A-Za-z0-9_-]+$/;

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authOrResponse = await resolveGatewayAuth(request);
    if (authOrResponse instanceof NextResponse) return authOrResponse;

    const { workspaceId, keyId, jarvisUrl, swarmApiKey } = authOrResponse;
    const { setId } = await params;

    // Rate limit — 60 req/min per API key
    const rl = await checkRateLimit(`gateway:evals:req:post:${keyId}`, 60, 60);
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

    // Validate setId pattern before using it in a URL
    if (!REF_ID_RE.test(setId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    console.log(`[Gateway Evals Requirements POST] workspaceId=${workspaceId}, keyId=${keyId}, setId=${setId}`);

    const config = { jarvisUrl, apiKey: swarmApiKey };

    // IDOR: verify the eval set belongs to this workspace — fail closed.
    // Any non-ok response from Jarvis → 404, never a pass-through.
    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const encodedSetId = encodeURIComponent(setId);
    let siblingsRes: Response;
    try {
      siblingsRes = await fetch(
        `${jarvisUrl}/v2/nodes/${encodedSetId}?expand=edges&edge_type=${edgeType}&depth=1`,
        { headers: { "x-api-token": swarmApiKey } },
      );
    } catch {
      console.warn(`[Gateway Evals Requirements POST] Jarvis fetch error for setId=${setId}`);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!siblingsRes.ok) {
      console.warn(`[Gateway Evals Requirements POST] Jarvis ${siblingsRes.status} for setId=${setId}`);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const siblingsData = await siblingsRes.json();
    const setNode = (siblingsData?.nodes ?? []).find(
      (n: JarvisNode) => n.ref_id === setId,
    );
    if (!setNode) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const ownerWorkspaceId =
      setNode.properties?.workspace_id ?? setNode.properties?.workspaceId;
    if (ownerWorkspaceId && ownerWorkspaceId !== workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const siblings = (siblingsData?.nodes ?? []).filter(
      (n: { ref_id?: string; node_type?: string }) =>
        n.ref_id !== setId &&
        String(n.node_type ?? "").toLowerCase() === "evalrequirement",
    );
    const siblingCount = siblings.length;

    const id = randomUUID();

    const nodeData: Record<string, unknown> = {
      id,
      name: name.trim(),
      description,
      prompt_snippet: typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
      desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
      undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
      contested: contestedCoerced ?? false,
    };

    const nodeResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: nodeData,
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
