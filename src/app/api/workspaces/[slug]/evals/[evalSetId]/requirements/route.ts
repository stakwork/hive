import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import {
  canWriteContested,
  coerce,
  hasContestedKey,
  resolveEvalSetScope,
} from "@/lib/evals/requirement-writes";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import type { JarvisNode } from "@/types/jarvis";


type RouteParams = { params: Promise<{ slug: string; evalSetId: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements GET] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements GET] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements GET] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
        { method: "GET" },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    console.log(`[Evals Requirements GET] Jarvis URL: ${jarvisUrl}`);

    const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
    const url = `${jarvisUrl}/v2/nodes/${evalSetId}?expand=edges&edge_type=${edgeType}&depth=1`;

    const jarvisRes = await fetch(url, {
      headers: { "x-api-token": swarmApiKey },
    });

    if (!jarvisRes.ok) {
      const text = await jarvisRes.text().catch(() => "");
      console.error(`[Evals Requirements GET] Jarvis error ${jarvisRes.status}: ${text}`);
      return NextResponse.json(
        { error: "Failed to fetch requirements from Jarvis" },
        { status: 502 },
      );
    }

    const jarvisData = await jarvisRes.json();
    // The depth-1 expand returns the EvalSet root node alongside its requirement
    // neighbors, and Jarvis node types come back inconsistently cased
    // ("Evalset" / "Evalrequirement"). Keep only requirement nodes (matched
    // case-insensitively) and drop the root so the set isn't listed as a requirement.
    const nodes: JarvisNode[] = (jarvisData?.nodes ?? []).filter(
      (n: JarvisNode) =>
        n.ref_id !== evalSetId &&
        String(n.node_type ?? "").toLowerCase() === "evalrequirement",
    );
    const edges: Array<{ target_ref_id: string; properties?: { order?: number }; edge_data?: { order?: number } }> =
      jarvisData?.edges ?? [];

    // Merge edge order into each node's properties
    for (const node of nodes) {
      const edge = edges.find((e) => e.target_ref_id === node.ref_id);
      if (edge) {
        const order = edge.properties?.order ?? edge.edge_data?.order;
        if (order !== undefined) {
          node.properties = { ...node.properties, order };
        }
      }
    }

    return NextResponse.json({ success: true, data: { nodes, total: nodes.length } });
  } catch (error) {
    console.error("[Evals/Requirements] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, evalSetId } = await params;
    console.log(`[Evals Requirements POST] slug=${slug}, evalSetId=${evalSetId}, userId=${userOrResponse.id}`);

    const body = await request.json();
    const { name, description, prompt_snippet, desirable_cases, undesirable_cases, order } =
      body ?? {};

    // A requirement only needs a name and an optional reason (description).
    // prompt_snippet and example cases are optional and may be added later.
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

    const swarmAccessResult = await getWorkspaceSwarmAccess(slug, userOrResponse.id);
    if (!swarmAccessResult.success) {
      console.warn(`[Evals Requirements POST] Swarm access denied: ${swarmAccessResult.error.type}`);
      return handleSwarmAccessError(swarmAccessResult.error);
    }
    console.log(`[Evals Requirements POST] Swarm access granted — swarmName=${swarmAccessResult.data.swarmName}, apiKey present=${!!swarmAccessResult.data.swarmApiKey}`);

    // Role gate applies ONLY when the body carries `contested`, so name /
    // description permissions stay exactly as they were for every existing user.
    if (hasContestedKey(body)) {
      const access = await resolveWorkspaceAccess(request, { slug });
      const member = requireMemberAccess(access);
      if (member instanceof NextResponse) return member;
      if (!canWriteContested(member.role)) {
        console.warn(`[Evals Requirements POST] contested write denied for role=${member.role}`);
        return NextResponse.json(
          { error: "Insufficient permissions to set contested" },
          { status: 403 },
        );
      }
    }

    if (process.env.USE_MOCKS === "true") {
      console.log(`[Evals Requirements POST] USE_MOCKS=true, routing to mock endpoint`);
      const mockResponse = await fetch(
        `${request.nextUrl.origin}/api/mock/evals/${evalSetId}/requirements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return NextResponse.json(await mockResponse.json());
    }

    const { swarmName, swarmApiKey } = swarmAccessResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };
    console.log(`[Evals Requirements POST] Jarvis URL: ${jarvisUrl}`);

    // Ownership: `evalSetId` is an opaque ref_id the caller supplied, and
    // addEdge would otherwise write to it unvalidated. Resolve it in this
    // workspace's own swarm first, and 404 if it isn't there.
    const scope = await resolveEvalSetScope(config, evalSetId);
    if (!scope.ok) {
      console.warn(`[Evals Requirements POST] Eval set not writable: ${scope.error}`);
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    const id = randomUUID();
    const nodeResult = await addNode(config, {
      node_type: "EvalRequirement",
      node_data: {
        id,
        name: name.trim(),
        description,
        prompt_snippet:
          typeof prompt_snippet === "string" ? prompt_snippet.trim() : undefined,
        desirable_cases: Array.isArray(desirable_cases) ? desirable_cases : [],
        undesirable_cases: Array.isArray(undesirable_cases) ? undesirable_cases : [],
        contested,
      },
    });
    console.log(`[Evals Requirements POST] addNode result: success=${nodeResult.success}, ref_id=${nodeResult.ref_id ?? 'n/a'}, error=${nodeResult.error ?? 'none'}`);

    if (!nodeResult.success || !nodeResult.ref_id) {
      return NextResponse.json(
        { error: nodeResult.error ?? "Failed to create requirement node" },
        { status: 502 },
      );
    }

    // Determine order: use provided value or default to 0
    const edgeOrder = typeof order === "number" ? order : 0;

    const edgeResult = await addEdge(config, {
      edge: { edge_type: "HAS_REQUIREMENT", edge_data: { order: edgeOrder } },
      source: { ref_id: evalSetId },
      target: { ref_id: nodeResult.ref_id },
    });
    console.log(`[Evals Requirements POST] addEdge result: success=${edgeResult.success}, error=${edgeResult.error ?? 'none'}`);

    if (!edgeResult.success) {
      console.warn(`[Evals Requirements POST] Failed to link requirement to eval set: ${edgeResult.error}`);
      return NextResponse.json(
        { error: edgeResult.error ?? "Failed to link requirement to eval set" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: { ref_id: nodeResult.ref_id } });
  } catch (error) {
    console.error("[Evals/Requirements] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
